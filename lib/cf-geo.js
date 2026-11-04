// ─────────────────────────────────────────
// CLOUDFLARE GEO
// On Cloudflare Workers every request arrives with
// location and network data already attached
// (request.cf). This turns it into the same shapes
// the existing strategies return, so no panel
// needs to change. No outside call, no database.
// ─────────────────────────────────────────
const vpn = require('../data/vpn-ranges')
const asnDb = require('./asn-database')
const classes = require('../data/asn-classes.json')

const regionName = (code) => {
  if (!code) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code
  } catch (e) {
    return code
  }
}

const utcOffset = (timezone) => {
  if (!timezone) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    }).formatToParts(new Date())
    const tz = parts.find(p => p.type === 'timeZoneName')
    const v = tz ? tz.value.replace('GMT', '') : ''
    return v === '' ? '+00:00' : v
  } catch (e) {
    return null
  }
}

// The network name Cloudflare reports can differ from the
// official name (sometimes it is a registry label such as
// "Reserved-for-Enterprise-Internet-WAN"). The ASN number is
// reliable, so networks are classified by number first, using
// data/asn-classes.json (built weekly from public-domain data),
// and by name only when the number is not in that list.
const CLASS_CATEGORY = { m: 'mobile', d: 'datacenter', c: 'cdn' }

const describe = (asn, cfOrg) => {
  const key = asn ? String(asn).replace(/\D/g, '') : ''
  const hit = key ? classes[key] : null
  const org = hit ? hit[1] : (cfOrg || null)
  let category = hit ? CLASS_CATEGORY[hit[0]] : null
  if (!category) {
    const pattern = asnDb.classifyByPattern(org || '') || {}
    category = pattern.category || null
  }
  const hosting =
    category === 'datacenter' ||
    category === 'cdn' ||
    vpn.isHostingProvider(org || '')
  const proxy = vpn.isVPNProvider(org || '')
  const mobile = category === 'mobile'
  return { org, hosting, proxy, mobile, category }
}

// Kept for callers that only have a name
const flagsFromOrg = (org, asn) => describe(asn, org)

const geoLocal = require('./geo-local')

// The local MaxMind-derived files are the primary source for
// location and network owner. Cloudflare's own request data
// fills only what they lack and describes only the connecting
// address, never one looked up on request.
const available = (req) =>
  !!(req && (req.geoLookup || (req.cf && req.cf.country)))

const resolve = async (req, ip) => {
  const asked = req.query && typeof req.query.ip === 'string' &&
    geoLocal.parseIp(req.query.ip) ? req.query.ip.trim() : null
  const target = asked || ip
  const cf = asked ? {} : (req.cf || {})

  let g = null
  try { g = req.geoLookup ? await req.geoLookup(target) : null } catch (e) { g = null }
  // Cloudflare's own data is used only where the local files
  // have no record at all, so the two sources are never mixed
  // into one place (for example a city from one and coordinates
  // from the other).
  const hasCity = !!(g && g.city)
  const hasAsn = !!(g && g.asn)
  const city = hasCity ? g.city : []
  const asnRec = hasAsn ? g.asn : []

  const asn = hasAsn ? asnRec[0] : (cf.asn || null)
  const rawOrg = hasAsn ? asnRec[1] : (cf.asOrganization || null)
  const f = describe(asn, rawOrg)
  const useCf = !hasCity
  const cc = hasCity ? city[0] : (cf.country || null)
  const sameCity = hasCity && cf.city && city[3] &&
    String(cf.city).toLowerCase() === String(city[3]).toLowerCase()

  return {
    target,
    f,
    asn,
    cc,
    region: hasCity ? city[2] : (cf.region || null),
    city: hasCity ? city[3] : (cf.city || null),
    lat: hasCity ? city[4] : (cf.latitude ? Number(cf.latitude) : null),
    lon: hasCity ? city[5] : (cf.longitude ? Number(cf.longitude) : null),
    tz: hasCity ? city[6] : (cf.timezone || null),
    radius: hasCity ? city[7] : null,
    continent: hasCity ? city[8] : (cf.continent || null),
    postal: (useCf || sameCity) ? (cf.postalCode || null) : null,
    source: (hasCity || hasAsn) ? 'maxmind-local' : 'cloudflare'
  }
}

// Shape used by ip-identity
const identity = async (req, ip) => {
  const r = await resolve(req, ip)
  const org = r.f.org
  return {
    ip: r.target,
    ipVersion: r.target.includes(':') ? 'IPv6' : 'IPv4',
    isp: org,
    org: org,
    asn: r.asn ? 'AS' + r.asn + (org ? ' ' + org : '') : null,
    country: regionName(r.cc),
    countryCode: r.cc,
    region: r.region,
    city: r.city,
    postal: r.postal,
    latitude: r.lat,
    longitude: r.lon,
    accuracyRadiusKm: r.radius,
    timezone: r.tz,
    utcOffset: utcOffset(r.tz),
    connectionType: r.f.mobile ? 'mobile' : r.f.proxy ? 'proxy' : r.f.hosting ? 'hosting' : 'broadband',
    mobile: r.f.mobile,
    proxy: r.f.proxy,
    hosting: r.f.hosting,
    continent: r.continent,
    source: r.source
  }
}

// Shape used by ip-deep
const deepRaw = async (req, ip) => {
  const r = await resolve(req, ip)
  const org = r.f.org
  return {
    ip: r.target,
    asn: r.asn ? 'AS' + r.asn + (org ? ' ' + org : '') : null,
    asnName: org,
    org: org,
    isp: org,
    countryCode: r.cc,
    country: regionName(r.cc),
    region: r.region,
    city: r.city,
    mobile: r.f.mobile,
    proxy: r.f.proxy,
    hosting: r.f.hosting,
    source: r.source
  }
}

module.exports = { available, identity, deepRaw, flagsFromOrg }
