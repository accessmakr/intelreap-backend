const fetch = require('node-fetch')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
}

const REQUEST_TIMEOUT_MS = 10000

// Known datacenter ASN ranges for
// frontend level classification
const DATACENTER_ASN_RANGES = [
  13335, 16509, 14618, 15169, 396982,
  8075, 14061, 16276, 24940, 20473,
  63949, 46484, 54113, 20940, 16625,
  22822, 33070, 31898, 135061, 45102,
  37963, 55967, 38365
]

// Known TOR exit node indicators
const TOR_INDICATORS = [
  'tor', 'torproject', 'exit node',
  'anonymous', 'onion'
]

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

// Frontend level ASN classification
// No API key required
const classifyFromASN = (asnNumber, orgName) => {
  const asnNum = parseInt(
    (asnNumber || '').toString().replace(/[^0-9]/g, ''),
    10
  )
  const org = (orgName || '').toLowerCase()

  const isDatacenter = DATACENTER_ASN_RANGES.includes(
    asnNum
  )
  const isTor = TOR_INDICATORS.some(
    indicator => org.includes(indicator)
  )
  const isMobile = (
    org.includes('mobile') ||
    org.includes('wireless') ||
    org.includes('cellular')
  )

  let vpnSuspicion = 'low'
  let proxySuspicion = 'low'
  let ipClassification = 'Residential'

  if (isDatacenter) {
    vpnSuspicion = 'medium'
    proxySuspicion = 'medium'
    ipClassification = 'Datacenter'
  }
  if (isMobile) {
    ipClassification = 'Mobile'
  }
  if (isTor) {
    vpnSuspicion = 'high'
    proxySuspicion = 'high'
    ipClassification = 'TOR'
  }

  const trustScore = isTor ? 10
    : isDatacenter ? 50
    : isMobile ? 75
    : 90

  return {
    vpnDetected: isTor ? 'maybe' : isDatacenter
      ? 'maybe'
      : 'no',
    proxyDetected: isDatacenter ? 'maybe' : 'no',
    torDetected: isTor ? 'yes' : 'no',
    datacenterDetected: isDatacenter ? 'yes' : 'no',
    ipClassification: ipClassification,
    vpnSuspicion: vpnSuspicion,
    proxySuspicion: proxySuspicion,
    fraudScore: isTor ? 85
      : isDatacenter ? 35
      : isMobile ? 15
      : 10,
    abuseScore: isTor ? 80
      : isDatacenter ? 25
      : 5,
    botDetected: 'no',
    trustScore: trustScore,
    routeClassification: isTor ? 'High Risk'
      : isDatacenter ? 'Suspect'
      : 'Clean',
    source: 'asn-classification',
    confidence: isDatacenter || isTor
      ? 'medium'
      : 'low'
  }
}

// ProxyCheck.io API strategy
const fetchProxyCheck = async (ip, apiKey) => {
  if (!apiKey) {
    throw new Error('ProxyCheck API key not configured')
  }

  const url = `https://proxycheck.io/v2/${ip}` +
    `?key=${apiKey}` +
    `&vpn=1` +
    `&asn=1` +
    `&risk=1` +
    `&port=1` +
    `&seen=1` +
    `&days=7` +
    `&tag=intelreap`

  const response = await fetchWithTimeout(url, {}, 9000)

  if (!response.ok) {
    throw new Error(
      `ProxyCheck failed: ${response.status}`
    )
  }

  const data = await response.json()

  if (data.status === 'error') {
    throw new Error(
      `ProxyCheck error: ${data.message}`
    )
  }

  const ipData = data[ip] || {}

  const isVpn = ipData.vpn === 'yes'
  const isProxy = ipData.proxy === 'yes'
  const isTor = (ipData.type || '')
    .toLowerCase()
    .includes('tor')
  const isDatacenter = (ipData.type || '')
    .toLowerCase()
    .includes('datacenter')

  const riskScore = parseInt(ipData.risk || 0, 10)

  const trustScore = Math.max(
    0,
    Math.min(100, 100 - riskScore)
  )

  return {
    vpnDetected: isVpn ? 'yes'
      : ipData.vpn === 'no' ? 'no'
      : 'maybe',
    proxyDetected: isProxy ? 'yes'
      : ipData.proxy === 'no' ? 'no'
      : 'maybe',
    torDetected: isTor ? 'yes' : 'no',
    datacenterDetected: isDatacenter ? 'yes' : 'no',
    ipClassification: isDatacenter
      ? 'Datacenter'
      : isTor ? 'TOR'
      : isVpn ? 'VPN'
      : isProxy ? 'Proxy'
      : 'Residential',
    asnNumber: ipData.asn || null,
    asnName: ipData.provider || null,
    countryCode: ipData.isocode || null,
    city: ipData.city || null,
    fraudScore: riskScore,
    abuseScore: Math.round(riskScore * 0.8),
    botDetected: riskScore > 80 ? 'yes' : 'no',
    trustScore: trustScore,
    routeClassification: riskScore > 75
      ? 'High Risk'
      : riskScore > 40 ? 'Suspect'
      : 'Clean',
    lastSeenProxy: ipData.last_seen_human || null,
    portOpen: ipData.port || null,
    proxyType: ipData.type || null,
    source: 'proxycheck',
    confidence: 'high'
  }
}

// IPQualityScore API strategy
const fetchIPQualityScore = async (ip, apiKey) => {
  if (!apiKey) {
    throw new Error(
      'IPQualityScore API key not configured'
    )
  }

  const url = `https://ipqualityscore.com/api/json/ip` +
    `/${apiKey}/${ip}` +
    `?strictness=1` +
    `&allow_public_access_points=true` +
    `&fast=false` +
    `&lighter_penalties=false` +
    `&mobile=true`

  const response = await fetchWithTimeout(url, {}, 9000)

  if (!response.ok) {
    throw new Error(
      `IPQualityScore failed: ${response.status}`
    )
  }

  const data = await response.json()

  if (!data.success) {
    throw new Error(
      `IPQualityScore error: ${data.message}`
    )
  }

  const fraudScore = data.fraud_score || 0
  const trustScore = Math.max(
    0,
    Math.min(100, 100 - fraudScore)
  )

  return {
    vpnDetected: data.vpn ? 'yes' : 'no',
    proxyDetected: data.proxy ? 'yes' : 'no',
    torDetected: data.tor ? 'yes' : 'no',
    datacenterDetected: data.active_vpn ||
      data.active_tor ? 'yes' : 'no',
    ipClassification: data.tor ? 'TOR'
      : data.vpn ? 'VPN'
      : data.proxy ? 'Proxy'
      : data.mobile ? 'Mobile'
      : 'Residential',
    asnNumber: data.ASN || null,
    asnName: data.ISP || null,
    organization: data.organization || null,
    countryCode: data.country_code || null,
    city: data.city || null,
    region: data.region || null,
    timezone: data.timezone || null,
    fraudScore: fraudScore,
    abuseScore: data.abuse_velocity === 'high'
      ? 80
      : data.abuse_velocity === 'medium'
      ? 50
      : data.abuse_velocity === 'low'
      ? 20
      : 5,
    botDetected: data.bot_status ? 'yes' : 'no',
    crawlerDetected: data.is_crawler ? 'yes' : 'no',
    trustScore: trustScore,
    routeClassification: fraudScore > 75
      ? 'High Risk'
      : fraudScore > 40 ? 'Suspect'
      : 'Clean',
    connectionType: data.connection_type || null,
    recentAbuse: data.recent_abuse ? 'yes' : 'no',
    abuseVelocity: data.abuse_velocity || null,
    source: 'ipqualityscore',
    confidence: 'high'
  }
}

// Get client IP from request headers
const extractClientIP = (req) => {
  const forwardedFor = req.headers['x-forwarded-for']
  if (forwardedFor) {
    const ips = forwardedFor.split(',')
    return ips[0].trim()
  }
  return req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    null
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

  Object.entries(CORS_HEADERS).forEach(
    ([key, value]) => res.setHeader(key, value)
  )

  // Extract IP from request
  const clientIP = extractClientIP(req) ||
    req.query?.ip ||
    null

  if (!clientIP) {
    return res.status(400).json({
      success: false,
      error: 'Could not determine client IP address',
      timestamp: new Date().toISOString()
    })
  }

  // Get API keys from environment
  const proxyCheckKey = process.env.PROXYCHECK_API_KEY
  const ipqsKey = process.env.IPQUALITYSCORE_API_KEY

  // Extract ASN from query for frontend
  // classification enrichment
  const queryAsn = req.query?.asn || null
  const queryOrg = req.query?.org || null

  // Always compute frontend classification first
  const frontendClassification = classifyFromASN(
    queryAsn,
    queryOrg
  )

  const errors = []

  // Strategy 1 — ProxyCheck
  try {
    const proxyCheckData = await fetchProxyCheck(
      clientIP,
      proxyCheckKey
    )

    // Merge frontend signals with API data
    const merged = {
      ...proxyCheckData,
      frontendSignals: frontendClassification,
      ip: clientIP,
      fetchedAt: new Date().toISOString(),
      responseTime: (Date.now() - startTime) + 'ms'
    }

    return res.status(200).json({
      success: true,
      data: merged
    })

  } catch (proxyCheckError) {
    errors.push({
      strategy: 'proxycheck',
      error: proxyCheckError.message
    })
  }

  // Strategy 2 — IPQualityScore
  try {
    const ipqsData = await fetchIPQualityScore(
      clientIP,
      ipqsKey
    )

    const merged = {
      ...ipqsData,
      frontendSignals: frontendClassification,
      ip: clientIP,
      fetchedAt: new Date().toISOString(),
      responseTime: (Date.now() - startTime) + 'ms'
    }

    return res.status(200).json({
      success: true,
      data: merged
    })

  } catch (ipqsError) {
    errors.push({
      strategy: 'ipqualityscore',
      error: ipqsError.message
    })
  }

  // Strategy 3 — Frontend classification only
  // Always available, never fails
  const fallbackData = {
    ...frontendClassification,
    ip: clientIP,
    fetchedAt: new Date().toISOString(),
    responseTime: (Date.now() - startTime) + 'ms',
    apiErrors: errors,
    notice: 'API enrichment unavailable — ' +
      'classification based on ASN intelligence'
  }

  return res.status(200).json({
    success: true,
    data: fallbackData
  })
}
