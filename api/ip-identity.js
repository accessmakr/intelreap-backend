const fetch = require('node-fetch')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
}

const REQUEST_TIMEOUT_MS = 8000

// Primary and fallback API endpoints
const IP_APIS = {
  primary: {
    ipify: 'https://api.ipify.org?format=json',
    ipifyV6: 'https://api64.ipify.org?format=json',
    geoip: 'https://ipapi.co/{IP}/json/'
  },
  fallback: {
    combined: 'https://ipwho.is/'
  },
  secondary: {
    combined: 'https://ip-api.com/json/?fields=66846719'
  }
}

// Create fetch with timeout
const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
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

// Normalize data from ipapi.co
const normalizeIpapiResponse = (ipData, geoData) => {
  return {
    ip: ipData.ip || null,
    ipVersion: ipData.ip?.includes(':') ? 'IPv6' : 'IPv4',
    isp: geoData.org || null,
    org: geoData.org || null,
    asn: geoData.asn || null,
    country: geoData.country_name || null,
    countryCode: geoData.country_code || null,
    region: geoData.region || null,
    city: geoData.city || null,
    postal: geoData.postal || null,
    latitude: geoData.latitude || null,
    longitude: geoData.longitude || null,
    timezone: geoData.timezone || null,
    utcOffset: geoData.utc_offset || null,
    connectionType: geoData.org?.toLowerCase().includes('mobile')
      ? 'mobile'
      : geoData.org?.toLowerCase().includes('fiber')
      ? 'fiber'
      : geoData.org?.toLowerCase().includes('cable')
      ? 'broadband'
      : 'broadband',
    currency: geoData.currency || null,
    languages: geoData.languages || null,
    callingCode: geoData.country_calling_code || null,
    continent: geoData.continent_code || null,
    source: 'ipapi'
  }
}

// Normalize data from ipwho.is
const normalizeIpwhoResponse = (data) => {
  return {
    ip: data.ip || null,
    ipVersion: data.type || (data.ip?.includes(':') ? 'IPv6' : 'IPv4'),
    isp: data.connection?.isp || data.org || null,
    org: data.org || data.connection?.org || null,
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
    currency: data.currency?.code || null,
    languages: null,
    callingCode: data.calling_code || null,
    continent: data.continent_code || null,
    source: 'ipwho'
  }
}

// Normalize data from ip-api.com
const normalizeIpApiComResponse = (data) => {
  return {
    ip: data.query || null,
    ipVersion: data.query?.includes(':') ? 'IPv6' : 'IPv4',
    isp: data.isp || null,
    org: data.org || null,
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
        Math.floor(data.offset / 3600) + ':00'
      : null,
    connectionType: data.mobile
      ? 'mobile'
      : data.proxy
      ? 'proxy'
      : 'broadband',
    currency: null,
    languages: null,
    callingCode: null,
    continent: null,
    source: 'ipApiCom'
  }
}

// Primary strategy: ipify + ipapi.co
const fetchPrimaryStrategy = async () => {
  // Step 1: Get public IP
  const ipResponse = await fetchWithTimeout(
    IP_APIS.primary.ipifyV6,
    {},
    5000
  )
  if (!ipResponse.ok) {
    throw new Error(
      `ipify failed: ${ipResponse.status}`
    )
  }
  const ipData = await ipResponse.json()
  if (!ipData.ip) {
    throw new Error('No IP returned from ipify')
  }

  // Step 2: Get geo data for that IP
  const geoUrl = IP_APIS.primary.geoip.replace(
    '{IP}',
    ipData.ip
  )
  const geoResponse = await fetchWithTimeout(
    geoUrl,
    {},
    6000
  )
  if (!geoResponse.ok) {
    throw new Error(
      `ipapi.co failed: ${geoResponse.status}`
    )
  }
  const geoData = await geoResponse.json()
  if (geoData.error) {
    throw new Error(
      `ipapi.co error: ${geoData.reason}`
    )
  }

  return normalizeIpapiResponse(ipData, geoData)
}

// Fallback strategy: ipwho.is
const fetchFallbackStrategy = async () => {
  const response = await fetchWithTimeout(
    IP_APIS.fallback.combined,
    {},
    6000
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
  return normalizeIpwhoResponse(data)
}

// Secondary fallback strategy: ip-api.com
const fetchSecondaryFallbackStrategy = async () => {
  const response = await fetchWithTimeout(
    IP_APIS.secondary.combined,
    {},
    6000
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
  return normalizeIpApiComResponse(data)
}

module.exports = async (req, res) => {

  // Handle preflight
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(
      ([key, value]) => res.setHeader(key, value)
    )
    return res.status(200).end()
  }

  // Method validation
  if (req.method !== 'GET') {
    Object.entries(CORS_HEADERS).forEach(
      ([key, value]) => res.setHeader(key, value)
    )
    return res.status(405).json({
      error: 'Method not allowed',
      allowedMethods: ['GET']
    })
  }

  const startTime = Date.now()

  // Set response headers
  Object.entries(CORS_HEADERS).forEach(
    ([key, value]) => res.setHeader(key, value)
  )

  // Execute with three tier fallback chain
  const strategies = [
    {
      name: 'primary',
      fn: fetchPrimaryStrategy
    },
    {
      name: 'fallback',
      fn: fetchFallbackStrategy
    },
    {
      name: 'secondary',
      fn: fetchSecondaryFallbackStrategy
    }
  ]

  const errors = []

  for (const strategy of strategies) {
    try {
      const data = await strategy.fn()

      // Validate essential fields
      if (!data.ip) {
        throw new Error(
          'Response missing IP address'
        )
      }

      const responseTime = Date.now() - startTime

      return res.status(200).json({
        success: true,
        data: {
          ...data,
          fetchedAt: new Date().toISOString(),
          responseTime: responseTime + 'ms',
          strategyUsed: strategy.name
        }
      })

    } catch (error) {
      errors.push({
        strategy: strategy.name,
        error: error.message
      })
      // Continue to next strategy
    }
  }

  // All three strategies failed
  return res.status(503).json({
    success: false,
    error: 'All enrichment strategies failed',
    details: errors,
    timestamp: new Date().toISOString(),
    responseTime: (Date.now() - startTime) + 'ms'
  })
}
