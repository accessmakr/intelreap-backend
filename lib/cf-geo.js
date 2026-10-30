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

const available = (req) => !!(req && req.cf && req.cf.country)

// Shape used by ip-identity
const identity = (req, ip) => {
  const cf = req.cf
  const f = describe(cf.asn, cf.asOrganization)
  const org = f.org
  return {
    ip: ip,
    ipVersion: ip.includes(':') ? 'IPv6' : 'IPv4',
    isp: org,
    org: org,
    asn: cf.asn ? 'AS' + cf.asn + (org ? ' ' + org : '') : null,
    country: regionName(cf.country),
    countryCode: cf.country || null,
    region: cf.region || null,
    city: cf.city || null,
    postal: cf.postalCode || null,
    latitude: cf.latitude ? Number(cf.latitude) : null,
    longitude: cf.longitude ? Number(cf.longitude) : null,
    timezone: cf.timezone || null,
    utcOffset: utcOffset(cf.timezone),
    connectionType: f.mobile ? 'mobile' : f.proxy ? 'proxy' : f.hosting ? 'hosting' : 'broadband',
    mobile: f.mobile,
    proxy: f.proxy,
    hosting: f.hosting,
    continent: cf.continent || null,
    source: 'cloudflare'
  }
}

// Shape used by ip-deep
const deepRaw = (req, ip) => {
  const cf = req.cf
  const f = describe(cf.asn, cf.asOrganization)
  const org = f.org
  return {
    ip: ip,
    asn: cf.asn ? 'AS' + cf.asn + (org ? ' ' + org : '') : null,
    asnName: org,
    org: org,
    isp: org,
    countryCode: cf.country || null,
    country: regionName(cf.country),
    region: cf.region || null,
    city: cf.city || null,
    mobile: f.mobile,
    proxy: f.proxy,
    hosting: f.hosting,
    source: 'cloudflare'
  }
}

module.exports = { available, identity, deepRaw, flagsFromOrg }
