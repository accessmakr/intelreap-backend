// ─────────────────────────────────────────
// FETCH GEO DATA (runs at Cloudflare build time)
// Downloads the newest MaxMind database files from a PRIVATE
// GitHub repository (never from this public repo: the MaxMind
// licence does not allow handing the databases to others).
// The scheduled workflow replaces the files there every two
// weeks, keeping a single version.
//
// Build variables (set in the Cloudflare dashboard):
//   GEO_DATA_REPO    owner/name of the private data repository
//   GEO_DATA_TOKEN   read-only access key for that repository
//   GEO_DATA_REF     optional, branch to read (default main)
//
// If the download fails, the files already in data/geoip/
// (if any) are used. With no files at all the shard build
// fails, so the deploy stops and the live Worker keeps running.
// ─────────────────────────────────────────
const fs = require('fs')
const path = require('path')

const REPO = process.env.GEO_DATA_REPO
const TOKEN = process.env.GEO_DATA_TOKEN
const REF = process.env.GEO_DATA_REF || 'main'
const DIR = path.join(__dirname, '..', 'data', 'geoip')
const FILES = ['GeoLite2-City.mmdb', 'GeoLite2-ASN.mmdb']
const MARKER = Buffer.from('\xAB\xCD\xEFMaxMind.com', 'latin1')

const looksValid = (buf) =>
  buf.length > 1000000 &&
  buf.subarray(Math.max(0, buf.length - 131072)).includes(MARKER)

const main = async () => {
  if (!REPO) {
    console.warn('geo data: GEO_DATA_REPO is not set; using the files already in data/geoip/')
    return
  }
  fs.mkdirSync(DIR, { recursive: true })
  const got = {}
  for (const f of FILES) {
    const url =
      `https://api.github.com/repos/${REPO}/contents/${f}?ref=${encodeURIComponent(REF)}`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'intelreap-build',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
      }
    })
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (!looksValid(buf)) throw new Error(`${f}: not a valid MaxMind file`)
    got[f] = buf
  }
  // only replace the files when both downloads are good
  for (const f of FILES) {
    fs.writeFileSync(path.join(DIR, f + '.new'), got[f])
    fs.renameSync(path.join(DIR, f + '.new'), path.join(DIR, f))
  }
  console.log('geo data: using the newest files from ' + REPO)
}

main().catch((e) => {
  console.warn('geo data: could not fetch (' + e.message + '); using any files already in data/geoip/')
})
