// ─────────────────────────────────────────
// BUILD GEO SHARDS
// Turns the two MaxMind databases (data/geoip/*.mmdb) into
// small static files in public/geo/ that the Cloudflare
// Worker can read on demand, with no database and no
// outside call. Rebuilt by the weekly workflow.
//
// File layout  public/geo/<db>/<family>/<shard>.bin
//   db       city | asn
//   family   v4 (shard = first octet, decimal)
//            v6 (shard = first 16 bits, 4 hex digits)
//   content  varint pairs (gap, idPlusOne)
//            gap = distance from the previous range start
//            (first gap = distance from the shard start);
//            idPlusOne 0 means "no data for this range".
//   v4 offsets count single addresses inside the /8.
//   v6 offsets count /48 blocks inside the /16.
//
// Values live once, in public/geo/<db>/values/<n>.json, an array
// of 256 values. Id i is entry i % 256 of file floor(i / 256).
// ─────────────────────────────────────────
const maxmind = require('maxmind')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.join(__dirname, '..')
const DB_DIR = path.join(ROOT, 'data', 'geoip')
const OUT = path.join(ROOT, 'public', 'geo')

const r2 = (n) =>
  typeof n === 'number' ? Math.round(n * 100) / 100 : 0

// Value shapes. Kept as short arrays to keep the files small.
// city: [countryCode, regionCode, regionName, city,
//        lat, lon, timeZone, accuracyKm, continentCode]
// asn:  [asnNumber, organisation]
const DBS = {
  city: {
    file: 'GeoLite2-City.mmdb',
    key: (rec) => {
      if (!rec) return null
      const sub = (rec.subdivisions && rec.subdivisions[0]) || {}
      const loc = rec.location || {}
      return [
        rec.country && rec.country.iso_code,
        sub.iso_code,
        rec.city && (rec.city.geoname_id || rec.city.names?.en),
        loc.time_zone,
        r2(loc.latitude),
        r2(loc.longitude)
      ].join('|')
    },
    value: (rec) => {
      const sub = (rec.subdivisions && rec.subdivisions[0]) || {}
      const loc = rec.location || {}
      return [
        (rec.country && rec.country.iso_code) ||
          (rec.registered_country && rec.registered_country.iso_code) ||
          null,
        sub.iso_code || null,
        (sub.names && sub.names.en) || null,
        (rec.city && rec.city.names && rec.city.names.en) || null,
        r2(loc.latitude),
        r2(loc.longitude),
        loc.time_zone || null,
        loc.accuracy_radius || null,
        (rec.continent && rec.continent.code) || null
      ]
    }
  },
  asn: {
    file: 'GeoLite2-ASN.mmdb',
    key: (rec) =>
      rec ? String(rec.autonomous_system_number) : null,
    value: (rec) => [
      rec.autonomous_system_number,
      rec.autonomous_system_organization || null
    ]
  }
}

const pushVar = (arr, n) => {
  while (n >= 128) {
    arr.push((n % 128) | 128)
    n = Math.floor(n / 128)
  }
  arr.push(n)
}

const v4str = (n) =>
  [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')

const v6str = (n) => {
  const g = []
  for (let i = 7; i >= 0; i--) {
    g.push(((n >> (BigInt(i) * 16n)) & 0xffffn).toString(16))
  }
  return g.join(':')
}

// Walk one shard and return {table, body} or null when empty.
const walkShard = (reader, def, family, shard, reg) => {
  const is4 = family === 'v4'
  const base = is4
    ? shard * 16777216
    : BigInt(shard) << 112n
  const end = is4
    ? base + 16777216
    : base + (1n << 112n)

  const body = []
  let ip = base
  let prevStart = 0
  let lastKey = undefined
  let hasData = false

  while (is4 ? ip < end : ip < end) {
    const [rec, plen] = reader.getWithPrefixLength(
      is4 ? v4str(ip) : v6str(ip)
    )
    const span = is4
      ? 2 ** (32 - plen)
      : 1n << BigInt(128 - plen)

    const key = rec ? def.key(rec) : null
    if (key !== lastKey) {
      let idx = 0
      if (key !== null) {
        if (!reg.index.has(key)) {
          reg.index.set(key, reg.values.length)
          reg.values.push(def.value(rec))
        }
        idx = reg.index.get(key) + 1
        hasData = true
      }
      const off = is4 ? ip - base : Number((ip - base) >> 80n)
      pushVar(body, off - prevStart)
      pushVar(body, idx)
      prevStart = off
      lastKey = key
    }

    if (is4) {
      ip = Math.floor(ip / span) * span + span
    } else {
      // never step finer than /48
      let step = span < (1n << 80n) ? 1n << 80n : span
      ip = (ip / step) * step + step
    }
  }
  return hasData ? { body } : null
}

const writeShard = (dbName, family, shard, res) => {
  const name = family === 'v4' ? String(shard) : shard.toString(16).padStart(4, '0')
  const dir = path.join(OUT, dbName, family)
  fs.mkdirSync(dir, { recursive: true })
  const buf = Buffer.from(res.body)
  fs.writeFileSync(path.join(dir, name + '.bin'), buf)
  return buf
}

const main = async () => {
  const only = process.argv[2] // optional: city | asn
  fs.rmSync(OUT, { recursive: true, force: true })
  const manifest = { built: new Date().toISOString(), dbs: {} }
  const stats = []

  for (const [dbName, def] of Object.entries(DBS)) {
    if (only && only !== dbName) continue
    const reader = await maxmind.open(path.join(DB_DIR, def.file))
    manifest.dbs[dbName] = {
      source: def.file,
      sourceBuilt: reader.metadata.buildEpoch.toISOString(),
      v4: [],
      v6: []
    }

    let raw = 0
    let gz = 0
    let files = 0
    const reg = { index: new Map(), values: [] }

    for (let s = 0; s < 256; s++) {
      const res = walkShard(reader, def, 'v4', s, reg)
      if (!res) continue
      const buf = writeShard(dbName, 'v4', s, res)
      manifest.dbs[dbName].v4.push(s)
      raw += buf.length
      gz += zlib.gzipSync(buf, { level: 9 }).length
      files++
    }

    // global unicast space: 2000::/3 = first 16 bits 0x2000-0x3fff
    for (let s = 0x2000; s <= 0x3fff; s++) {
      const res = walkShard(reader, def, 'v6', s, reg)
      if (!res) continue
      const buf = writeShard(dbName, 'v6', s, res)
      manifest.dbs[dbName].v6.push(s)
      raw += buf.length
      gz += zlib.gzipSync(buf, { level: 9 }).length
      files++
    }
    const vdir = path.join(OUT, dbName, 'values')
    fs.mkdirSync(vdir, { recursive: true })
    for (let i = 0; i * 256 < reg.values.length; i++) {
      const buf = Buffer.from(JSON.stringify(reg.values.slice(i * 256, i * 256 + 256)))
      fs.writeFileSync(path.join(vdir, i + '.json'), buf)
      raw += buf.length
      gz += zlib.gzipSync(buf, { level: 9 }).length
      files++
    }
    manifest.dbs[dbName].values = reg.values.length
    stats.push({ db: dbName, files, rawMB: +(raw / 1e6).toFixed(2), gzMB: +(gz / 1e6).toFixed(2) })
  }

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest))
  console.log(JSON.stringify(stats))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
