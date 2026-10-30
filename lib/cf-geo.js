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

// Flags that ip-api used to provide, derived locally
// from the network owner's name.
const flagsFromOrg = (org) => {
  const pattern = asnDb.classifyByPattern(org || '') || {}
  const category = pattern.category || null
  const hosting =
    category === 'datacenter' ||
    category === 'cdn' ||
    vpn.isHostingProvider(org || '')
  const proxy = vpn.isVPNProvider(org || '')
  const mobile = category === 'mobile'
  return { hosting, proxy, mobile, category }
}

const available = (req) => !!(req && req.cf && req.cf.country)

// Shape used by ip-identity
const identity = (req, ip) => {
  const cf = req.cf
  const org = cf.asOrganization || null
  const f = flagsFromOrg(org)
  return {
    ip: ip,
    ipVersion: ip.includes(':') ? 'IPv6' : 'IPv4',
    isp: org,
    org: org,
    asn: cf.asn ? 'AS' + cf.asn : null,
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
  const org = cf.asOrganization || null
  const f = flagsFromOrg(org)
  return {
    ip: ip,
    asn: cf.asn ? 'AS' + cf.asn : null,
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
