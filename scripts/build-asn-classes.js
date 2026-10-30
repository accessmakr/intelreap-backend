// ─────────────────────────────────────────
// BUILD ASN CLASSES
// Builds data/asn-classes.json from the public-domain
// ipverse/as-metadata list (CC0). It keeps only
// networks whose official name marks them as mobile,
// datacenter/hosting or CDN, with their official name,
// so the Worker can classify a network by ASN number
// and does not depend on the name Cloudflare reports.
// Run weekly by .github/workflows/update-asn-classes.yml
// ─────────────────────────────────────────
const fs = require('fs')
const path = require('path')

const SOURCE =
  'https://raw.githubusercontent.com/ipverse/as-metadata/master/as.csv'

// Strict word-based rules. Loose rules for guessing from a
// name would mislabel names such as "Global" or "Telecom"
// as mobile, so these are narrower.
const MOBILE = new RegExp(
  '\\b(mobile|mobility|wireless|cellular|gsm|lte|mvno|mtn|airtel|' +
  'vodafone|globacom|9mobile|etisalat|safaricom|zain|tigo|claro|' +
  'telcel|movistar|digicel|ooredoo|jio|t-mobile|sprint|' +
  'us cellular)\\b', 'i')
const HOSTING = new RegExp(
  '\\b(hosting|datacenter|data center|data centre|colocation|vps|' +
  'dedicated servers?|cloud servers?|web hosting|server hosting)\\b', 'i')
const CDN = /\b(cdn|content delivery)\b/i

// Well-known networks, by number
const KNOWN = {
  16509: 'd', 14618: 'd', 15169: 'd', 396982: 'd', 8075: 'd',
  14061: 'd', 24940: 'd', 16276: 'd', 63949: 'd', 20473: 'd',
  51167: 'd', 60781: 'd', 45102: 'd', 132203: 'd', 31898: 'd',
  36351: 'd', 13335: 'c', 54113: 'c', 20940: 'c'
}

const classify = (name, handle) => {
  const text = name + ' ' + handle
  if (CDN.test(text)) return 'c'
  if (MOBILE.test(text)) return 'm'
  if (HOSTING.test(text)) return 'd'
  return null
}

const parseLine = (line) => {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q
    } else if (c === ',' && !q) {
      out.push(cur); cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

const run = async () => {
  let text
  if (process.argv[2]) {
    text = fs.readFileSync(process.argv[2], 'utf8')
  } else {
    const r = await fetch(SOURCE)
    if (!r.ok) throw new Error('download failed: ' + r.status)
    text = await r.text()
  }
  const lines = text.split(/\r?\n/).slice(1)
  const out = {}
  for (const line of lines) {
    if (!line) continue
    const [asn, handle, name] = parseLine(line)
    if (!asn || !name) continue
    const cls = KNOWN[asn] || classify(name, handle)
    if (cls) out[asn] = [cls, name]
  }
  const file = path.join(__dirname, '..', 'data', 'asn-classes.json')
  fs.writeFileSync(file, JSON.stringify(out))
  const counts = {}
  Object.values(out).forEach(v => { counts[v[0]] = (counts[v[0]] || 0) + 1 })
  console.log('ASNs kept:', Object.keys(out).length, counts,
    'bytes:', fs.statSync(file).size)
}

run().catch(e => { console.error(e); process.exit(1) })
