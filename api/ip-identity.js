const fetch = require('node-fetch')
const cache = require('../lib/cache')
const geoip = require('../lib/geoip')
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

// Extract real client IP from request
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

// Normalize ip-api.com response
const normalizeIPAPI = (data, ip) => {
  return {
    ip: ip,
    ipVersion: ip.includes(':') ? 'IPv6' : 'IPv4',
    isp: data.isp || data.org || null,
    org: data.org || data.isp || null,
    asn: data.as || null,
    country: data.country || null,
    countryCode: data.countryCode || null,
    region: data.regionName || null,
    city: data.city || null,
    postal: data.zip || null,
    latitude: data.lat || null,
    longitude: data.lon || null,
    timezone: data.timezone || null,
    utcOffset: data.offset
      ? (data.offset >= 0 ? '+' : '') +
        String(Math.floor(
          Math.abs(data.offset) / 3600
        )).padStart(2, '0') +
        ':' +
        String(Math.floor(
          (Math.abs(data.offset) % 3600) / 60
        )).padStart(2, '0')
      : null,
    connectionType: data.mobile
      ? 'mobile'
      : data.proxy
      ? 'proxy'
      : 'broadband',
    mobile: data.mobile || false,
    proxy: data.proxy || false,
    hosting: data.hosting || false,
    continent: null,
    source: 'ip-api'
  }
}

// Normalize ipwho.is response
const normalizeIPWho = (data) => {
  return {
    ip: data.ip,
    ipVersion: data.type ||
      (data.ip?.includes(':') ? 'IPv6' : 'IPv4'),
    isp: data.connection?.isp ||
      data.connection?.org ||
      data.org || null,
    org: data.org ||
      data.connection?.org || null,
    asn: data.connection?.asn
      ? `AS${data.connection.asn}`
      : null,
    country: data.country || null,
    countryCode: data.country_code || null,
    region: data.region || null,
    city: data.city || null,
    postal: data.postal || null,
    latitude: data.latitude || null,
    longitude: data.longitude || null,
    timezone: data.timezone?.id || null,
    utcOffset: data.timezone?.utc || null,
    connectionType: data.connection?.domain
      ? 'broadband'
      : 'unknown',
    mobile: false,
    proxy: false,
    hosting: false,
    continent: data.continent_code || null,
    source: 'ipwho'
  }
}

// Normalize MaxMind response
const normalizeMaxMind = (data, ip) => {
  return {
    ip: ip,
    ipVersion: ip.includes(':') ? 'IPv6' : 'IPv4',
    isp: data.asnOrg || null,
    org: data.asnOrg || null,
    asn: data.asn || null,
    country: data.country || null,
    countryCode: data.countryCode || null,
    region: data.region || null,
    city: data.city || null,
    postal: data.postal || null,
    latitude: data.latitude || null,
    longitude: data.longitude || null,
    timezone: data.timezone || null,
    utcOffset: data.utcOffset || null,
    connectionType: data.connectionType || null,
    mobile: false,
    proxy: false,
    hosting: false,
    continent: data.continentCode || null,
    source: 'maxmind-local'
  }
}

// STRATEGY 1 — ip-api.com (PRIMARY)
// Free, no monthly limit
// 45 requests per minute
const fetchIPAPI = async (ip) => {
  const fields = [
    'status', 'message', 'country',
    'countryCode', 'region', 'regionName',
    'city', 'zip', 'lat', 'lon',
    'timezone', 'offset', 'isp', 'org',
    'as', 'mobile', 'proxy', 'hosting',
    'query'
  ].join(',')

  const response = await fetchWithTimeout(
    `http://ip-api.com/json/${ip}?fields=${fields}`,
    {},
    7000
  )

  if (!response.ok) {
    throw new Error(
      `ip-api.com failed: ${response.status}`
    )
  }

  const data = await response.json()

  if (data.status === 'fail') {
    throw new Error(
      `ip-api.com error: ${data.message}`
    )
  }

  return normalizeIPAPI(data, ip)
}

// STRATEGY 2 — ipwho.is (FALLBACK)
const fetchIPWho = async (ip) => {
  const url = ip
    ? `https://ipwho.is/${ip}`
    : 'https://ipwho.is/'

  const response = await fetchWithTimeout(
    url,
    {},
    7000
  )

  if (!response.ok) {
    throw new Error(
      `ipwho.is failed: ${response.status}`
    )
  }

  const data = await response.json()

  if (!data.success && data.success !== undefined) {
    throw new Error('ipwho.is returned failure')
  }

  return normalizeIPWho(data)
}

// STRATEGY 3 — MaxMind local (FALLBACK)
const fetchMaxMind = async (ip) => {
  const isReady = geoip.isAvailable()

  if (!isReady) {
    await geoip.initialize()
  }

  if (!geoip.isAvailable()) {
    throw new Error('MaxMind databases not available')
  }

  const data = await geoip.lookup(ip)

  if (!data) {
    throw new Error(
      `MaxMind returned no data for ${ip}`
    )
  }

  return normalizeMaxMind(data, ip)
}

module.exports = async (req, res) => {

  // Run full validation pipeline
  const validation = await validator.validate(
    req,
    res,
    'ip-identity'
  )

  if (!validation.valid) return

  const startTime = Date.now()
  const clientIP = req.clientIP ||
    extractClientIP(req)

  // Check Redis cache first
  const cacheKey = cache.KEYS.ipIdentity(clientIP)
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

  // Execute three tier fallback chain
  const strategies = [
    { name: 'ip-api', fn: () => fetchIPAPI(clientIP) },
    { name: 'ipwho', fn: () => fetchIPWho(clientIP) },
    { name: 'maxmind', fn: () => fetchMaxMind(clientIP) }
  ]

  const errors = []

  for (const strategy of strategies) {
    try {
      const data = await strategy.fn()

      if (!data.ip) {
        throw new Error('Response missing IP')
      }

      // Enrich with fetch timestamp
      const enriched = {
        ...data,
        fetchedAt: new Date().toISOString(),
        strategyUsed: strategy.name
      }

      // Cache successful result
      await cache.set(
        cacheKey,
        enriched,
        cache.TTL.IP_IDENTITY
      )

      const responseTime =
        Date.now() - startTime

      return res.status(200).json({
        success: true,
        data: {
          ...enriched,
          fromCache: false,
          responseTime: responseTime + 'ms'
        }
      })

    } catch (error) {
      errors.push({
        strategy: strategy.name,
        error: error.message
      })
    }
  }

  // All strategies failed
  return res.status(503).json({
    success: false,
    error: 'All IP identity strategies failed',
    details: errors,
    ip: clientIP,
    timestamp: new Date().toISOString(),
    responseTime: (Date.now() - startTime) + 'ms'
  })
}
