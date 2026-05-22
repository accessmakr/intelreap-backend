const fetch = require('node-fetch')
const cache = require('../lib/cache')
const proxyEngine = require('../lib/proxy-engine')
const vpnRanges = require('../data/vpn-ranges')
const validator = require('../lib/request-validator')

const REQUEST_TIMEOUT_MS = 10000

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

// ProxyCheck API strategy
// Only called for high risk signals
const fetchProxyCheck = async (ip, apiKey) => {
  if (!apiKey) {
    throw new Error(
      'ProxyCheck API key not configured'
    )
  }

  const url =
    `https://proxycheck.io/v2/${ip}` +
    `?key=${apiKey}` +
    `&vpn=1&asn=1&risk=1` +
    `&port=1&seen=1&days=7` +
    `&tag=intelreap`

  const response = await fetchWithTimeout(
    url,
    {},
    9000
  )

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
    .toLowerCase().includes('tor')
  const isDatacenter = (ipData.type || '')
    .toLowerCase().includes('datacenter')
  const riskScore = parseInt(
    ipData.risk || 0, 10
  )

  return {
    vpnDetected: isVpn ? 'yes'
      : ipData.vpn === 'no' ? 'no'
      : 'maybe',
    proxyDetected: isProxy ? 'yes'
      : ipData.proxy === 'no' ? 'no'
      : 'maybe',
    torDetected: isTor ? 'yes' : 'no',
    datacenterDetected:
      isDatacenter ? 'yes' : 'no',
    ipClassification: isDatacenter
      ? 'Datacenter'
      : isTor ? 'TOR'
      : isVpn ? 'VPN'
      : isProxy ? 'Proxy'
      : 'Residential',
    fraudScore: riskScore,
    abuseScore: Math.round(riskScore * 0.8),
    trustScore: Math.max(0, 100 - riskScore),
    routeClassification: riskScore > 75
      ? 'High Risk'
      : riskScore > 40 ? 'Suspect'
      : 'Clean',
    proxyType: ipData.type || null,
    lastSeenProxy:
      ipData.last_seen_human || null,
    portOpen: ipData.port || null,
    source: 'proxycheck',
    confidence: 'high'
  }
}

// IPQualityScore API strategy
// Secondary paid API fallback
const fetchIPQualityScore = async (
  ip,
  apiKey
) => {
  if (!apiKey) {
    throw new Error(
      'IPQualityScore API key not configured'
    )
  }

  const url =
    `https://ipqualityscore.com/api/json/ip` +
    `/${apiKey}/${ip}` +
    `?strictness=1` +
    `&allow_public_access_points=true` +
    `&fast=false` +
    `&lighter_penalties=false` +
    `&mobile=true`

  const response = await fetchWithTimeout(
    url,
    {},
    9000
  )

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

  return {
    vpnDetected: data.vpn ? 'yes' : 'no',
    proxyDetected: data.proxy ? 'yes' : 'no',
    torDetected: data.tor ? 'yes' : 'no',
    datacenterDetected:
      data.active_vpn || data.active_tor
        ? 'yes' : 'no',
    ipClassification: data.tor ? 'TOR'
      : data.vpn ? 'VPN'
      : data.proxy ? 'Proxy'
      : data.mobile ? 'Mobile'
      : 'Residential',
    fraudScore: fraudScore,
    abuseScore: data.abuse_velocity === 'high'
      ? 80
      : data.abuse_velocity === 'medium'
      ? 50
      : data.abuse_velocity === 'low'
      ? 20
      : 5,
    trustScore: Math.max(0, 100 - fraudScore),
    routeClassification: fraudScore > 75
      ? 'High Risk'
      : fraudScore > 40 ? 'Suspect'
      : 'Clean',
    botDetected: data.bot_status ? 'yes' : 'no',
    recentAbuse: data.recent_abuse ? 'yes' : 'no',
    connectionType:
      data.connection_type || null,
    abuseVelocity:
      data.abuse_velocity || null,
    source: 'ipqualityscore',
    confidence: 'high'
  }
}

// Determine if paid API should be called
// Saves quota for genuinely suspicious IPs
const shouldCallPaidAPI = (engineResult) => {
  // Only call paid APIs when our engine
  // detects meaningful suspicion
  // This multiplies free quota significantly

  if (engineResult.vpnDetected === 'yes') {
    return true
  }
  if (engineResult.torDetected === 'yes') {
    return true
  }
  if (engineResult.fraudScore >= 35) {
    return true
  }
  if (
    engineResult.mismatchAnalysis
      ?.timezone?.mismatch
  ) {
    return true
  }
  if (
    engineResult.ipAPIData?.hosting === true
  ) {
    return true
  }

  // Clean residential connection
  // No need to waste paid API quota
  return false
}

module.exports = async (req, res) => {

  // Run full validation pipeline
  const validation = await validator.validate(
    req,
    res,
    'proxy-intelligence'
  )

  if (!validation.valid) return

  const startTime = Date.now()
  const clientIP = req.clientIP ||
    extractClientIP(req)

  // Check Redis cache first
  const cacheKey =
    cache.KEYS.proxyIntelligence(clientIP)
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

  // Get browser signals from query params
  const query = req.sanitizedQuery || {}
  const browserSignals = {
    timezone: query.tz || null,
    language: query.lang || null
  }

  // Get ASN data from query params
  // Frontend passes these from ip-deep response
  const asnNumber = query.asn || null
  const orgName = query.org || null
  const ipCountryCode = query.cc || null

  // Get VPN org analysis
  const orgAnalysis = orgName
    ? vpnRanges.analyzeOrgName(orgName)
    : null

  // STEP 1 — Run our own proxy engine
  // Always runs, always free, never fails
  const engineResult = await proxyEngine.detect(
    clientIP,
    ipCountryCode,
    asnNumber,
    orgName,
    browserSignals
  )

  // STEP 2 — Decide if paid APIs needed
  const needsPaidAPI =
    shouldCallPaidAPI(engineResult)

  let paidAPIResult = null
  let paidAPISource = null
  const paidAPIErrors = []

  if (needsPaidAPI) {
    const proxyCheckKey =
      process.env.PROXYCHECK_API_KEY
    const ipqsKey =
      process.env.IPQUALITYSCORE_API_KEY

    // Try ProxyCheck first
    try {
      paidAPIResult = await fetchProxyCheck(
        clientIP,
        proxyCheckKey
      )
      paidAPISource = 'proxycheck'
    } catch (pcError) {
      paidAPIErrors.push({
        api: 'proxycheck',
        error: pcError.message
      })

      // Try IPQualityScore as fallback
      try {
        paidAPIResult = await fetchIPQualityScore(
          clientIP,
          ipqsKey
        )
        paidAPISource = 'ipqualityscore'
      } catch (ipqsError) {
        paidAPIErrors.push({
          api: 'ipqualityscore',
          error: ipqsError.message
        })
      }
    }
  }

  // Build final merged result
  // Paid API data takes priority when available
  const finalResult = paidAPIResult
    ? {
        // Core detection from paid API
        vpnDetected:
          paidAPIResult.vpnDetected,
        proxyDetected:
          paidAPIResult.proxyDetected,
        torDetected:
          paidAPIResult.torDetected,
        datacenterDetected:
          paidAPIResult.datacenterDetected,
        ipClassification:
          paidAPIResult.ipClassification,

        // Scores from paid API
        fraudScore: paidAPIResult.fraudScore,
        abuseScore: paidAPIResult.abuseScore,
        botDetected:
          paidAPIResult.botDetected ||
          engineResult.botDetected,
        trustScore: paidAPIResult.trustScore,
        routeClassification:
          paidAPIResult.routeClassification,

        // Mismatch signals from our engine
        // Browser signals paid APIs cannot see
        timezoneMatch:
          engineResult.timezoneMatch,
        languageMatch:
          engineResult.languageMatch,
        asnOwnershipType:
          engineResult.asnOwnershipType,

        // Additional paid API data
        proxyType:
          paidAPIResult.proxyType || null,
        lastSeenProxy:
          paidAPIResult.lastSeenProxy || null,
        recentAbuse:
          paidAPIResult.recentAbuse || null,
        connectionType:
          paidAPIResult.connectionType || null,

        // Source tracking
        primarySource: paidAPISource,
        engineSource: 'proxy-engine',
        confidence: 'high'
      }
    : {
        // Use our engine results only
        vpnDetected: engineResult.vpnDetected,
        proxyDetected:
          engineResult.proxyDetected,
        torDetected: engineResult.torDetected,
        datacenterDetected:
          engineResult.datacenterDetected,
        ipClassification:
          engineResult.ipClassification,
        timezoneMatch:
          engineResult.timezoneMatch,
        languageMatch:
          engineResult.languageMatch,
        asnOwnershipType:
          engineResult.asnOwnershipType,
        fraudScore: engineResult.fraudScore,
        abuseScore: engineResult.abuseScore,
        botDetected: engineResult.botDetected,
        trustScore: engineResult.trustScore,
        routeClassification:
          engineResult.routeClassification,
        primarySource: 'proxy-engine',
        engineSource: 'proxy-engine',
        confidence: engineResult.confidence
      }

  // Add supporting intelligence
  const enriched = {
    ...finalResult,

    // VPN ranges analysis
    orgAnalysis: orgAnalysis
      ? {
          isVPNProvider:
            orgAnalysis.isVPNProvider,
          isMajorVPN:
            orgAnalysis.isMajorVPNProvider,
          isHosting:
            orgAnalysis.isHostingProvider,
          isResidential:
            orgAnalysis.isResidentialISP,
          classification:
            orgAnalysis.classification,
          riskLevel: orgAnalysis.riskLevel
        }
      : null,

    // Detection flags
    detectionFlags:
      engineResult.detectionFlags || [],

    // Mismatch details
    mismatchAnalysis:
      engineResult.mismatchAnalysis || null,

    // Paid API errors if any
    paidAPIErrors: paidAPIErrors.length > 0
      ? paidAPIErrors
      : undefined,

    // Whether paid API was consulted
    paidAPIConsulted: needsPaidAPI,

    // IP info
    ip: clientIP,

    // Meta
    fetchedAt: new Date().toISOString()
  }

  // Cache result
  // 6 hours TTL for proxy data
  await cache.set(
    cacheKey,
    enriched,
    cache.TTL.PROXY_INTELLIGENCE
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
