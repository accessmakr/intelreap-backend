// ─────────────────────────────────────────
// LOCAL GEO LOOKUP
// Reads the small static shard files built from the MaxMind
// GeoLite2 databases (scripts/build-geo-shards.js) through the
// Worker's static assets. No outside call, no database server:
// one shard of a few hundred KB is read and kept in memory.
// ─────────────────────────────────────────
const SHARD_CACHE_MAX = 48
const shards = new Map() // key -> Promise<{starts, ids} | null>
const valueFiles = new Map() // key -> Promise<array | null>

const touch = (map, key, val) => {
  map.delete(key)
  map.set(key, val)
  while (map.size > SHARD_CACHE_MAX) {
    map.delete(map.keys().next().value)
  }
}

// Parse an IPv4 or IPv6 literal into { fam, shard, off, name }
// or null. IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as IPv4.
const parseIp = (raw) => {
  if (typeof raw !== 'string') return null
  let ip = raw.trim().replace(/^\[|\]$/g, '').split('%')[0]
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) ip = mapped[1]

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const p = ip.split('.').map(Number)
    if (p.some(n => n > 255)) return null
    return {
      fam: 'v4',
      name: String(p[0]),
      off: (p[1] * 65536) + (p[2] * 256) + p[3]
    }
  }

  if (!ip.includes(':') || !/^[0-9a-f:.]+$/i.test(ip)) return null
  let head = ip
  const m4 = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (m4) {
    const p = m4[2].split('.').map(Number)
    if (p.some(n => n > 255)) return null
    head = m4[1] + (((p[0] << 8) | p[1]).toString(16)) + ':' + (((p[2] << 8) | p[3]).toString(16))
  }
  const halves = head.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups
  if (halves.length === 2) {
    const fill = 8 - left.length - right.length
    if (fill < 1) return null
    groups = [...left, ...Array(fill).fill('0'), ...right]
  } else {
    groups = left
  }
  if (groups.length !== 8) return null
  const n = groups.map(g => parseInt(g, 16))
  if (n.some(x => !Number.isInteger(x) || x < 0 || x > 0xffff)) return null
  return {
    fam: 'v6',
    name: n[0].toString(16).padStart(4, '0'),
    off: (n[1] * 65536) + n[2]
  }
}

const readVarints = (buf) => {
  const starts = []
  const ids = []
  let pos = 0
  let acc = 0
  let isGap = true
  while (pos < buf.length) {
    let v = 0
    let mul = 1
    let b
    do {
      b = buf[pos++]
      v += (b & 127) * mul
      mul *= 128
    } while (b & 128 && pos < buf.length)
    if (isGap) { acc += v; starts.push(acc) } else { ids.push(v) }
    isGap = !isGap
  }
  return { starts, ids }
}

const fetchAsset = async (env, path) => {
  if (!env || !env.ASSETS) return null
  const res = await env.ASSETS.fetch(new Request('https://assets.local' + path))
  return res.ok ? res : null
}

const loadShard = (env, db, fam, name) => {
  const key = `${db}/${fam}/${name}`
  if (shards.has(key)) {
    const p = shards.get(key)
    touch(shards, key, p)
    return p
  }
  const p = (async () => {
    try {
      const res = await fetchAsset(env, `/geo/${key}.bin`)
      if (!res) return null
      return readVarints(new Uint8Array(await res.arrayBuffer()))
    } catch (e) { return null }
  })()
  touch(shards, key, p)
  // do not keep failures forever
  p.then(v => { if (v === null) shards.delete(key) })
  return p
}

const loadValues = (env, db, bucket) => {
  const key = `${db}/${bucket}`
  if (valueFiles.has(key)) return valueFiles.get(key)
  const p = (async () => {
    try {
      const res = await fetchAsset(env, `/geo/${db}/values/${bucket}.json`)
      return res ? await res.json() : null
    } catch (e) { return null }
  })()
  touch(valueFiles, key, p)
  p.then(v => { if (v === null) valueFiles.delete(key) })
  return p
}

// Look one address up in one database. Returns the value array
// (see scripts/build-geo-shards.js) or null.
const lookupDb = async (env, db, parsed) => {
  const shard = await loadShard(env, db, parsed.fam, parsed.name)
  if (!shard || !shard.starts.length) return null
  const { starts, ids } = shard
  let lo = 0
  let hi = starts.length - 1
  if (parsed.off < starts[0]) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= parsed.off) lo = mid
    else hi = mid - 1
  }
  const id = ids[lo] - 1
  if (id < 0) return null
  const values = await loadValues(env, db, Math.floor(id / 256))
  return values ? (values[id % 256] || null) : null
}

// { city: [...]|null, asn: [...]|null } or null for a bad address
const lookup = async (env, ip) => {
  const parsed = parseIp(ip)
  if (!parsed) return null
  const [city, asn] = await Promise.all([
    lookupDb(env, 'city', parsed),
    lookupDb(env, 'asn', parsed)
  ])
  return { city, asn }
}

module.exports = { lookup, parseIp }
