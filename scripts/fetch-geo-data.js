// ─────────────────────────────────────────
// FETCH GEO DATA (runs at Cloudflare build time)
// Downloads the newest MaxMind database files from the
// `geo-data` branch, which the scheduled workflow replaces
// every two weeks. If anything fails (offline, private repo
// without a token, bad file) the copies committed in
// data/geoip/ are used instead, so a build never breaks here.
//
// Optional environment variables:
//   GEO_DATA_REPO    default accessmakr/intelreap-backend
//   GEO_DATA_BRANCH  default geo-data
//   GEO_DATA_TOKEN   only needed if the repo is private
// ─────────────────────────────────────────
const fs = require('fs')
const path = require('path')

const REPO = process.env.GEO_DATA_REPO || 'accessmakr/intelreap-backend'
const BRANCH = process.env.GEO_DATA_BRANCH || 'geo-data'
const TOKEN = process.env.GEO_DATA_TOKEN
const DIR = path.join(__dirname, '..', 'data', 'geoip')
const FILES = ['GeoLite2-City.mmdb', 'GeoLite2-ASN.mmdb']
const MARKER = Buffer.from('\xAB\xCD\xEFMaxMind.com', 'latin1')

const looksValid = (buf) =>
  buf.length > 1000000 &&
  buf.subarray(Math.max(0, buf.length - 131072)).includes(MARKER)

const main = async () => {
  fs.mkdirSync(DIR, { recursive: true })
  const got = {}
  for (const f of FILES) {
    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${f}`
    const res = await fetch(url, {
      headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {}
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
  console.log('geo data: using the newest files from branch ' + BRANCH)
}

main().catch((e) => {
  console.warn('geo data: could not fetch (' + e.message + '); using the committed files')
})
