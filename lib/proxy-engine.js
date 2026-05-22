const fetch = require('node-fetch')
const cache = require('./cache')

// Timezone to country code mapping
// Used for timezone mismatch detection
const TIMEZONE_COUNTRY_MAP = {
  'Africa/Lagos': ['NG'],
  'Africa/Abidjan': ['CI', 'GH', 'GM', 'GN'],
  'Africa/Accra': ['GH'],
  'Africa/Nairobi': ['KE', 'ET', 'TZ', 'UG'],
  'Africa/Cairo': ['EG'],
  'Africa/Johannesburg': ['ZA', 'LS', 'SZ'],
  'Africa/Casablanca': ['MA'],
  'Africa/Tunis': ['TN'],
  'Africa/Algiers': ['DZ'],
  'Africa/Khartoum': ['SD'],
  'Africa/Addis_Ababa': ['ET'],
  'Africa/Dar_es_Salaam': ['TZ'],
  'Africa/Kampala': ['UG'],
  'Africa/Dakar': ['SN'],
  'Africa/Douala': ['CM'],
  'Africa/Luanda': ['AO'],
  'Africa/Lusaka': ['ZM'],
  'Africa/Harare': ['ZW'],
  'Africa/Maputo': ['MZ'],
  'Africa/Kinshasa': ['CD', 'CG'],
  'America/New_York': ['US'],
  'America/Chicago': ['US'],
  'America/Denver': ['US'],
  'America/Los_Angeles': ['US'],
  'America/Toronto': ['CA'],
  'America/Vancouver': ['CA'],
  'America/Sao_Paulo': ['BR'],
  'America/Mexico_City': ['MX'],
  'America/Buenos_Aires': ['AR'],
  'America/Bogota': ['CO'],
  'America/Lima': ['PE'],
  'America/Santiago': ['CL'],
  'Europe/London': ['GB'],
  'Europe/Paris': ['FR'],
  'Europe/Berlin': ['DE'],
  'Europe/Rome': ['IT'],
  'Europe/Madrid': ['ES'],
  'Europe/Amsterdam': ['NL'],
  'Europe/Brussels': ['BE'],
  'Europe/Zurich': ['CH'],
  'Europe/Vienna': ['AT'],
  'Europe/Warsaw': ['PL'],
  'Europe/Prague': ['CZ'],
  'Europe/Budapest': ['HU'],
  'Europe/Bucharest': ['RO'],
  'Europe/Stockholm': ['SE'],
  'Europe/Oslo': ['NO'],
  'Europe/Copenhagen': ['DK'],
  'Europe/Helsinki': ['FI'],
  'Europe/Athens': ['GR'],
  'Europe/Istanbul': ['TR'],
  'Europe/Moscow': ['RU'],
  'Europe/Kiev': ['UA'],
  'Asia/Dubai': ['AE'],
  'Asia/Riyadh': ['SA'],
  'Asia/Kuwait': ['KW'],
  'Asia/Qatar': ['QA'],
  'Asia/Bahrain': ['BH'],
  'Asia/Baghdad': ['IQ'],
  'Asia/Tehran': ['IR'],
  'Asia/Karachi': ['PK'],
  'Asia/Kolkata': ['IN'],
  'Asia/Dhaka': ['BD'],
  'Asia/Colombo': ['LK'],
  'Asia/Kathmandu': ['NP'],
  'Asia/Bangkok': ['TH', 'LA', 'KH', 'VN'],
  'Asia/Singapore': ['SG', 'MY'],
  'Asia/Kuala_Lumpur': ['MY'],
  'Asia/Jakarta': ['ID'],
  'Asia/Shanghai': ['CN'],
  'Asia/Hong_Kong': ['HK'],
  'Asia/Tokyo': ['JP'],
  'Asia/Seoul': ['KR'],
  'Asia/Manila': ['PH'],
  'Asia/Taipei': ['TW'],
  'Asia/Almaty': ['KZ'],
  'Asia/Tashkent': ['UZ'],
  'Australia/Sydney': ['AU'],
  'Australia/Melbourne': ['AU'],
  'Australia/Perth': ['AU'],
  'Pacific/Auckland': ['NZ'],
  'Pacific/Honolulu': ['US']
}

// Language to country code mapping
// Used for language mismatch detection
const LANGUAGE_COUNTRY_MAP = {
  'en': ['US', 'GB', 'CA', 'AU', 'NZ',
         'IE', 'ZA', 'NG', 'GH', 'KE',
         'UG', 'TZ', 'ZM', 'ZW', 'BW'],
  'en-US': ['US'],
  'en-GB': ['GB'],
  'en-NG': ['NG'],
  'en-GH': ['GH'],
  'en-ZA': ['ZA'],
  'fr': ['FR', 'BE', 'CH', 'LU', 'MC',
         'CI', 'SN', 'CM', 'BJ', 'ML'],
  'de': ['DE', 'AT', 'CH', 'LI'],
  'es': ['ES', 'MX', 'AR', 'CO', 'PE',
         'VE', 'CL', 'EC', 'BO', 'PY'],
  'pt': ['PT', 'BR', 'AO', 'MZ', 'CV'],
  'pt-BR': ['BR'],
  'it': ['IT', 'CH', 'SM', 'VA'],
  'nl': ['NL', 'BE', 'SR'],
  'pl': ['PL'],
  'ru': ['RU', 'BY', 'KZ', 'KG'],
  'ar': ['SA', 'AE', 'EG', 'IQ', 'SY',
         'JO', 'LB', 'MA', 'DZ', 'TN'],
  'zh': ['CN', 'TW', 'SG', 'HK'],
  'zh-CN': ['CN'],
  'zh-TW': ['TW'],
  'ja': ['JP'],
  'ko': ['KR'],
  'hi': ['IN'],
  'tr': ['TR'],
  'fa': ['IR'],
  'th': ['TH'],
  'vi': ['VN'],
  'id': ['ID'],
  'ms': ['MY', 'SG', 'BN'],
  'sw': ['KE', 'TZ', 'UG'],
  'ha': ['NG', 'NE', 'GH'],
  'yo': ['NG', 'BJ'],
  'ig': ['NG']
}

// Known VPN and hosting provider
// IP range patterns
// These are CIDR notation prefixes
// that belong to known providers
const KNOWN_VPN_PROVIDERS = [
  'NordVPN', 'ExpressVPN', 'Surfshark',
  'CyberGhost', 'IPVanish', 'PureVPN',
  'ProtonVPN', 'Mullvad', 'Private Internet Access',
  'TunnelBear', 'Windscribe', 'HideMyAss',
  'VyprVPN', 'StrongVPN', 'HotspotShield'
]

// Fetch with timeout helper
const fetchWithTimeout = async (
  url,
  options = {},
  timeoutMs = 8000
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

// Detect timezone mismatch
// Compares IP country with
// browser reported timezone
const detectTimezoneMismatch = (
  ipCountryCode,
  browserTimezone
) => {
  if (!ipCountryCode || !browserTimezone) {
    return {
      checked: false,
      mismatch: false,
      reason: 'Insufficient data'
    }
  }

  const expectedCountries =
    TIMEZONE_COUNTRY_MAP[browserTimezone]

  if (!expectedCountries) {
    return {
      checked: true,
      mismatch: false,
      reason: 'Timezone not in mapping — inconclusive',
      browserTimezone: browserTimezone,
      ipCountry: ipCountryCode
    }
  }

  const match = expectedCountries.includes(
    ipCountryCode.toUpperCase()
  )

  return {
    checked: true,
    mismatch: !match,
    result: match ? 'PASS' : 'FAIL',
    browserTimezone: browserTimezone,
    ipCountry: ipCountryCode,
    expectedCountries: expectedCountries,
    severity: !match ? 'medium' : 'none'
  }
}

// Detect language mismatch
// Compares IP country with
// browser reported language
const detectLanguageMismatch = (
  ipCountryCode,
  browserLanguage
) => {
  if (!ipCountryCode || !browserLanguage) {
    return {
      checked: false,
      mismatch: false,
      reason: 'Insufficient data'
    }
  }

  // Try exact match first
  let expectedCountries =
    LANGUAGE_COUNTRY_MAP[browserLanguage]

  // Try base language if no exact match
  if (!expectedCountries) {
    const baseLang = browserLanguage.split('-')[0]
    expectedCountries =
      LANGUAGE_COUNTRY_MAP[baseLang]
  }

  if (!expectedCountries) {
    return {
      checked: true,
      mismatch: false,
      reason: 'Language not in mapping — inconclusive',
      browserLanguage: browserLanguage,
      ipCountry: ipCountryCode
    }
  }

  // English is spoken in many countries
  // including Nigeria so be lenient
  const match = expectedCountries.includes(
    ipCountryCode.toUpperCase()
  )

  return {
    checked: true,
    mismatch: !match,
    result: match ? 'PASS' : 'FAIL',
    browserLanguage: browserLanguage,
    ipCountry: ipCountryCode,
    expectedCountries: expectedCountries,
    severity: !match ? 'low' : 'none'
  }
}

// Fetch ip-api.com proxy detection
// Uses the free proxy and hosting flags
// 45 requests per minute limit
// No monthly limit
const fetchIPAPIProxyData = async (ip) => {
  const cacheKey = `ipapi:proxy:${ip}`

  // Check cache first
  const cached = await cache.get(cacheKey)
  if (cached) return { ...cached, fromCache: true }

  try {
    const response = await fetchWithTimeout(
      `http://ip-api.com/json/${ip}?fields=proxy,hosting,mobile,isp,org,as,countryCode`,
      {},
      6000
    )

    if (!response.ok) {
      throw new Error(
        `ip-api.com proxy check failed: ${response.status}`
      )
    }

    const data = await response.json()

    if (data.status === 'fail') {
      throw new Error(
        `ip-api.com error: ${data.message}`
      )
    }

    const result = {
      proxy: data.proxy || false,
      hosting: data.hosting || false,
      mobile: data.mobile || false,
      isp: data.isp || null,
      org: data.org || null,
      asn: data.as || null,
      countryCode: data.countryCode || null,
      source: 'ip-api'
    }

    // Cache for 6 hours
    await cache.set(
      cacheKey,
      result,
      cache.TTL.PROXY_INTELLIGENCE
    )

    return result

  } catch (error) {
    return {
      proxy: null,
      hosting: null,
      mobile: null,
      error: error.message,
      source: 'ip-api-failed'
    }
  }
}

// ASN based proxy detection
// Uses MaxMind ASN data and
// our classification engine
const detectFromASN = async (
  asnNumber,
  orgName
) => {
  const asnDb = require('./asn-database')
  const org = (orgName || '').toLowerCase()

  // Get classification
  const classification =
    asnDb.classifyASNSync(asnNumber, orgName)

  const isDatacenter =
    classification.category === 'datacenter' ||
    classification.category === 'cdn'

  // Check for known VPN provider names
  const isKnownVPN = KNOWN_VPN_PROVIDERS.some(
    provider => org.includes(
      provider.toLowerCase()
    )
  )

  // Check for TOR indicators
  const isTOR =
    org.includes('tor') ||
    org.includes('torproject') ||
    org.includes('exit node') ||
    org.includes('anonymous')

  return {
    isDatacenter: isDatacenter,
    isKnownVPN: isKnownVPN,
    isTOR: isTOR,
    asnType: classification.type,
    asnCategory: classification.category,
    provider: classification.provider
  }
}

// Compute overall proxy risk score
// Based on all available signals
const computeProxyRiskScore = (signals) => {
  let score = 0
  const flags = []

  // ip-api.com proxy flag (most reliable)
  if (signals.ipAPIProxy === true) {
    score += 70
    flags.push('ip-api proxy flag active')
  }

  // ip-api.com hosting flag
  if (signals.ipAPIHosting === true) {
    score += 40
    flags.push('hosting/datacenter IP detected')
  }

  // ASN based detection
  if (signals.asnIsDatacenter) {
    score += 30
    flags.push('ASN classified as datacenter')
  }

  if (signals.asnIsKnownVPN) {
    score += 80
    flags.push('known VPN provider ASN')
  }

  if (signals.asnIsTOR) {
    score += 90
    flags.push('TOR exit node detected')
  }

  // Mismatch signals
  if (signals.timezoneMismatch) {
    score += 20
    flags.push('timezone does not match IP location')
  }

  if (signals.languageMismatch) {
    score += 10
    flags.push('browser language does not match IP location')
  }

  // Mobile carrier reduces VPN suspicion
  if (signals.ipAPIMobile === true) {
    score = Math.max(0, score - 20)
  }

  // Cap at 100
  score = Math.min(100, score)

  // Determine classifications
  const vpnDetected = score >= 70
    ? 'yes'
    : score >= 35
    ? 'maybe'
    : 'no'

  const torDetected = signals.asnIsTOR
    ? 'yes'
    : 'no'

  const proxyDetected = signals.ipAPIProxy
    ? 'yes'
    : score >= 50
    ? 'maybe'
    : 'no'

  const trustScore = Math.max(
    0,
    100 - score
  )

  const routeClassification = score >= 70
    ? 'High Risk'
    : score >= 35
    ? 'Suspect'
    : 'Clean'

  return {
    riskScore: score,
    trustScore: trustScore,
    vpnDetected: vpnDetected,
    proxyDetected: proxyDetected,
    torDetected: torDetected,
    routeClassification: routeClassification,
    flags: flags,
    confidence: signals.ipAPIProxy !== null
      ? 'high'
      : 'medium'
  }
}

// Main proxy detection engine
// Combines all available signals
const detect = async (
  ip,
  ipCountryCode,
  asnNumber,
  orgName,
  browserSignals
) => {
  const startTime = Date.now()

  // Run ip-api and ASN checks in parallel
  const [ipAPIData, asnData] =
    await Promise.all([
      fetchIPAPIProxyData(ip),
      detectFromASN(asnNumber, orgName)
    ])

  // Timezone mismatch detection
  const timezoneMismatch = detectTimezoneMismatch(
    ipCountryCode,
    browserSignals?.timezone
  )

  // Language mismatch detection
  const languageMismatch = detectLanguageMismatch(
    ipCountryCode,
    browserSignals?.language
  )

  // Compile all signals
  const signals = {
    ipAPIProxy: ipAPIData.proxy,
    ipAPIHosting: ipAPIData.hosting,
    ipAPIMobile: ipAPIData.mobile,
    asnIsDatacenter: asnData.isDatacenter,
    asnIsKnownVPN: asnData.isKnownVPN,
    asnIsTOR: asnData.isTOR,
    timezoneMismatch: timezoneMismatch.mismatch,
    languageMismatch: languageMismatch.mismatch
  }

  // Compute risk score from all signals
  const riskAssessment =
    computeProxyRiskScore(signals)

  const responseTime = Date.now() - startTime

  return {
    // Core detection results
    vpnDetected: riskAssessment.vpnDetected,
    proxyDetected: riskAssessment.proxyDetected,
    torDetected: riskAssessment.torDetected,
    datacenterDetected:
      asnData.isDatacenter ? 'yes' : 'no',

    // Classification
    ipClassification: asnData.isTOR
      ? 'TOR'
      : asnData.isKnownVPN
      ? 'VPN'
      : ipAPIData.proxy
      ? 'Proxy'
      : ipAPIData.hosting
      ? 'Datacenter'
      : ipAPIData.mobile
      ? 'Mobile'
      : 'Residential',

    asnOwnershipType: asnData.asnType,

    // Mismatch signals
    timezoneMatch: timezoneMismatch.checked
      ? (timezoneMismatch.mismatch ? 'FAIL' : 'PASS')
      : 'UNKNOWN',
    languageMatch: languageMismatch.checked
      ? (languageMismatch.mismatch ? 'FAIL' : 'PASS')
      : 'UNKNOWN',

    // Scores
    fraudScore: riskAssessment.riskScore,
    abuseScore: Math.round(
      riskAssessment.riskScore * 0.7
    ),
    trustScore: riskAssessment.trustScore,
    botDetected: riskAssessment.riskScore > 85
      ? 'yes'
      : 'no',

    // Route intelligence
    routeClassification:
      riskAssessment.routeClassification,

    // Supporting data
    detectionFlags: riskAssessment.flags,
    confidence: riskAssessment.confidence,
    ipAPIData: {
      proxy: ipAPIData.proxy,
      hosting: ipAPIData.hosting,
      mobile: ipAPIData.mobile,
      fromCache: ipAPIData.fromCache || false
    },
    asnAnalysis: {
      type: asnData.asnType,
      category: asnData.asnCategory,
      isDatacenter: asnData.isDatacenter,
      isKnownVPN: asnData.isKnownVPN,
      isTOR: asnData.isTOR
    },
    mismatchAnalysis: {
      timezone: timezoneMismatch,
      language: languageMismatch
    },

    // Meta
    source: 'proxy-engine',
    responseTime: responseTime + 'ms',
    detectedAt: new Date().toISOString()
  }
}

module.exports = {
  detect,
  detectTimezoneMismatch,
  detectLanguageMismatch,
  fetchIPAPIProxyData,
  detectFromASN,
  computeProxyRiskScore,
  TIMEZONE_COUNTRY_MAP,
  LANGUAGE_COUNTRY_MAP,
  KNOWN_VPN_PROVIDERS
}
