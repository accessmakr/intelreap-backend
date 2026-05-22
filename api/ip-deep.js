const fetch = require('node-fetch')
const cache = require('../lib/cache')
const geoip = require('../lib/geoip')
const asnDb = require('../lib/asn-database')
const validator = require('../lib/request-validator')

const REQUEST_TIMEOUT_MS = 8000

const fetchWithTimeout = async (
  url,
  options = {},
  timeoutMs = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  )
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'IntelreapService/1.0',
        ...options.headers
      }
    })
    clearTimeout(timeout)
    return response
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

// Extract real client IP
const extractClientIP = (req) => {
  const forwardedFor =
    req.headers['x-forwarded-for']
  if (forwardedFor) {
    const ips = forwardedFor
      .split(',')
      .map(ip => ip.trim())
    const realIP = ips[0]
    const ipv4Regex =
      /^(\d{1,3}\.){3}\d{1,3}$/
    const ipv6Regex =
      /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
    if (
      ipv4Regex.test(realIP) ||
      ipv6Regex.test(realIP)
    ) {
      return realIP
    }
  }
  return (
    req.headers['x-real-ip'] ||
    req.headers['cf-connecting-ip'] ||
    req.connection?.remoteAddress ||
    'unknown'
  )
}

// Build IP range from IP address
const buildIPRange = (ip) => {
  if (!ip || ip.includes(':')) return null
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  return `${parts[0]}.${parts[1]}.0.0/16`
}

// STRATEGY 1 — ip-api.com (PRIMARY)
// Returns ASN, org, hosting flags
// No monthly limit
const fetchIPAPIDeep = async (ip) => {
  const fields = [
    'status', 'message', 'country',
    'countryCode', 'regionName', 'city',
    'lat', 'lon', 'timezone', 'offset',
    'isp', 'org', 'as', 'asname',
    'mobile', 'proxy', 'hosting', 'query'
  ].join(',')

  const response = await fetchWithTimeout(
    `http://ip-api.com/json/${ip}?fields=${fields}`,
    {},
    7000
  )

  if (!response.ok) {
    throw new Error(
      `ip-api.com deep failed: ${response.status}`
    )
  }

  const data = await response.json()

  if (data.status === 'fail') {
    throw new Error(
      `ip-api.com error: ${data.message}`
    )
  }

  return {
    ip: ip,
    asn: data.as || null,
    asnName: data.asname || null,
    org: data.org || null,
    isp: data.isp || null,
    countryCode: data.countryCode || null,
    country: data.country || null,
    region: data.regionName || null,
    city: data.city || null,
    mobile: data.mobile || false,
    proxy: data.proxy || false,
    hosting: data.hosting || false,
    source: 'ip-api'
  }
}

// STRATEGY 2 — ipwho.is (FALLBACK)
const fetchIPWhoDeep = async (ip) => {
  const response = await fetchWithTimeout(
    `https://ipwho.is/${ip}`,
    {},
    7000
  )

  if (!response.ok) {
    throw new Error(
      `ipwho.is deep failed: ${response.status}`
    )
  }

  const data = await response.json()

  if (
    !data.success &&
    data.success !== undefined
  ) {
    throw new Error('ipwho.is returned failure')
  }

  return {
    ip: ip,
    asn: data.connection?.asn
      ? `AS${data.connection.asn}`
      : null,
    asnName: data.connection?.isp || null,
    org: data.org ||
      data.connection?.org || null,
    isp: data.connection?.isp || null,
    countryCode: data.country_code || null,
    country: data.country || null,
    region: data.region || null,
    city: data.city || null,
    mobile: false,
    proxy: false,
    hosting: false,
    source: 'ipwho'
  }
}

// STRATEGY 3 — MaxMind local (FALLBACK)
const fetchMaxMindDeep = async (ip) => {
  if (!geoip.isAvailable()) {
    await geoip.initialize()
  }

  if (!geoip.isAvailable()) {
    throw new Error(
      'MaxMind databases not available'
    )
  }

  const [cityData, asnData] = await Promise.all([
    geoip.lookupCity(ip),
    geoip.lookupASN(ip)
  ])

  if (!asnData && !cityData) {
    throw new Error(
      'MaxMind returned no data'
    )
  }

  return {
    ip: ip,
    asn: asnData?.asn || null,
    asnName: asnData?.asnOrg || null,
    org: asnData?.asnOrg || null,
    isp: asnData?.asnOrg || null,
    countryCode: cityData?.countryCode || null,
    country: cityData?.country || null,
    region: cityData?.region || null,
    city: cityData?.city || null,
    mobile: false,
    proxy: false,
    hosting: false,
    source: 'maxmind-local'
  }
}

// Build complete deep intelligence
// from raw API data and our engines
const buildDeepIntelligence = async (
  rawData,
  ip
) => {
  const asnNumber = rawData.asn
    ? parseInt(
        String(rawData.asn)
          .replace(/[^0-9]/g, ''),
        10
      )
    : null

  const orgName = rawData.org ||
    rawData.isp ||
    rawData.asnName

  // Get full ASN classification
  // Uses PeeringDB + pattern matching
  const classification = await asnDb.classifyASN(
    asnNumber,
    orgName,
    {
      hosting: rawData.hosting,
      mobile: rawData.mobile,
      proxy: rawData.proxy,
      org: orgName,
      isp: rawData.isp,
      as: rawData.asn
    }
  )

  const registry = asnDb.getRegistry(
    rawData.countryCode
  )

  const networkHealth = asnDb.computeNetworkHealth(
    classification.tier,
    classification.type,
    'active',
    classification.prefixes4
  )

  const tierLabel = asnDb.getTierLabel(
    classification.tier
  )

  const peeringCount = asnDb.estimatePeeringCount(
    classification.tier,
    classification.prefixes4
  )

  const upstreamProvider = asnDb.getUpstreamProvider(
    classification.tier,
    classification.type
  )

  const ipRange = buildIPRange(ip)

  return {
    // Core ASN data
    asn: rawData.asn || null,
    asnNumber: asnNumber,
    asnOwner: classification.provider || orgName,
    asnType: classification.type,
    asnCategory: classification.category,

    // Known provider detection
    knownProvider: classification.isKnown
      ? classification.provider
      : null,

    // Network classification
    networkTier: tierLabel,
    networkTierNumber: classification.tier,
    routeOrigin: classification.category === 'datacenter'
      ? 'Cloud Hosted'
      : classification.category === 'cdn'
      ? 'CDN Edge'
      : classification.category === 'satellite'
      ? 'Satellite'
      : classification.category === 'mobile'
      ? 'Mobile Network'
      : 'Direct ISP',

    // Registry and allocation
    allocationRegistry: registry,
    bgpRouteStatus: 'active',
    networkAnnouncementStatus: 'announced',

    // Network topology
    ipRange: ipRange,
    estimatedPeeringCount: peeringCount,
    upstreamProvider: upstreamProvider,

    // PeeringDB enrichment if available
    peeringdbData: classification.peeringdbId
      ? {
          id: classification.peeringdbId,
          traffic: classification.traffic,
          prefixes4: classification.prefixes4,
          prefixes6: classification.prefixes6,
          website: classification.website,
          policyGeneral: classification.policyGeneral
        }
      : null,

    // Scores
    networkHealthScore: networkHealth,

    // Classification confidence
    classificationSource: classification.source,
    classificationConfidence:
      classification.confidence,

    // Flags from ip-api.com
    isHosting: rawData.hosting || false,
    isMobile: rawData.mobile || false,
    isProxy: rawData.proxy || false,

    // Raw org data
    rawOrg: orgName,
    rawASN: rawData.asn,
    countryCode: rawData.countryCode
  }
}

module.exports = async (req, res) => {

  // Run full validation pipeline
  const validation = await validator.validate(
    req,
    res,
    'ip-deep'
  )

  if (!validation.valid) return

  const startTime = Date.now()
  const clientIP = req.clientIP ||
    extractClientIP(req)

  // Check Redis cache first
  const cacheKey = cache.KEYS.ipDeep(clientIP)
  const cached = await cache.get(cacheKey)

  if (cached) {
    return res.status(200).json({
      success: true,
      data: {
        ...cached,
        fromCache: true,
        responseTime:
          (Date.now() - startTime) + 'ms'
      }
    })
  }

  // Three tier fallback chain
  const strategies = [
    {
      name: 'ip-api',
      fn: () => fetchIPAPIDeep(clientIP)
    },
    {
      name: 'ipwho',
      fn: () => fetchIPWhoDeep(clientIP)
    },
    {
      name: 'maxmind',
      fn: () => fetchMaxMindDeep(clientIP)
    }
  ]

  const errors = []
  let rawData = null
  let strategyUsed = null

  for (const strategy of strategies) {
    try {
      rawData = await strategy.fn()
      strategyUsed = strategy.name
      break
    } catch (error) {
      errors.push({
        strategy: strategy.name,
        error: error.message
      })
    }
  }

  if (!rawData) {
    return res.status(503).json({
      success: false,
      error: 'All deep intelligence strategies failed',
      details: errors,
      timestamp: new Date().toISOString(),
      responseTime:
        (Date.now() - startTime) + 'ms'
    })
  }

  // Build complete deep intelligence
  const deepData = await buildDeepIntelligence(
    rawData,
    clientIP
  )

  const enriched = {
    ...deepData,
    fetchedAt: new Date().toISOString(),
    dataSource: strategyUsed,
    strategyErrors: errors.length > 0
      ? errors
      : undefined
  }

  // Cache for 24 hours
  await cache.set(
    cacheKey,
    enriched,
    cache.TTL.IP_DEEP
  )

  const responseTime = Date.now() - startTime

  return res.status(200).json({
    success: true,
    data: {
      ...enriched,
      fromCache: false,
      responseTime: responseTime + 'ms'
    }
  })
}
