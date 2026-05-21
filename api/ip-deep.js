const fetch = require('node-fetch')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
}

const REQUEST_TIMEOUT_MS = 8000

// Known datacenter and cloud provider ASNs
const DATACENTER_ASNS = {
  13335: 'Cloudflare',
  16509: 'Amazon AWS',
  14618: 'Amazon AWS',
  15169: 'Google Cloud',
  396982: 'Google Cloud',
  8075: 'Microsoft Azure',
  14061: 'DigitalOcean',
  16276: 'OVH',
  24940: 'Hetzner',
  20473: 'Vultr',
  63949: 'Linode',
  46484: 'Linode',
  54113: 'Fastly',
  32934: 'Facebook',
  20940: 'Akamai',
  16625: 'Akamai',
  22822: 'Limelight',
  209: 'CenturyLink',
  3356: 'Lumen',
  7922: 'Comcast',
  33070: 'Oracle Cloud',
  31898: 'Oracle Cloud',
  135061: 'Oracle Cloud',
  45102: 'Alibaba Cloud',
  37963: 'Alibaba Cloud',
  55967: 'Baidu',
  38365: 'Baidu',
  4134: 'China Telecom',
  4837: 'China Unicom'
}

// Known mobile carrier ASNs
const MOBILE_ASNS = {
  29465: 'MTN Nigeria',
  36873: 'MTN Nigeria',
  37076: 'Airtel Nigeria',
  37122: 'Globacom Nigeria',
  36916: '9mobile Nigeria',
  33776: 'Airtel Africa',
  328794: 'MTN South Africa',
  16637: 'MTN South Africa',
  36994: 'Vodacom South Africa',
  37457: 'Telkom South Africa',
  6713: 'IAM Morocco',
  36903: 'MTN Ghana',
  29614: 'Vodafone Ghana',
  15924: 'Orange France',
  12322: 'Free France',
  5607: 'Sky UK',
  31334: 'Vodafone Germany',
  3320: 'Deutsche Telekom',
  7018: 'AT&T',
  22394: 'Verizon Wireless',
  21928: 'T-Mobile US',
  1239: 'Sprint'
}

// Known education and government ASNs patterns
const EDU_PATTERNS = [
  'university', 'college', 'school',
  'edu', 'academic', 'research',
  'institute', 'campus'
]

const GOV_PATTERNS = [
  'government', 'federal', 'ministry',
  'military', 'defense', 'agency',
  'municipal', 'state', 'national'
]

// Network tier classification
const classifyNetworkTier = (asnNumber, orgName) => {
  const tier1Providers = [
    'AT&T', 'Verizon', 'Sprint', 'Lumen',
    'CenturyLink', 'NTT', 'Tata', 'Cogent',
    'Level 3', 'Hurricane Electric', 'Zayo',
    'GTT', 'Telia', 'Deutsche Telekom',
    'Telecom Italia', 'Orange', 'BT'
  ]
  const org = (orgName || '').toLowerCase()
  const isTier1 = tier1Providers.some(
    p => org.includes(p.toLowerCase())
  )
  if (isTier1) return 'Tier 1'
  if (DATACENTER_ASNS[asnNumber]) return 'Tier 2'
  return 'Tier 3'
}

// ASN type classification
const classifyAsnType = (asnNumber, orgName) => {
  if (DATACENTER_ASNS[asnNumber]) return 'Datacenter'
  if (MOBILE_ASNS[asnNumber]) return 'Mobile Carrier'
  const org = (orgName || '').toLowerCase()
  if (EDU_PATTERNS.some(p => org.includes(p))) {
    return 'Education'
  }
  if (GOV_PATTERNS.some(p => org.includes(p))) {
    return 'Government'
  }
  if (
    org.includes('wireless') ||
    org.includes('mobile') ||
    org.includes('cellular')
  ) {
    return 'Mobile Carrier'
  }
  if (
    org.includes('cloud') ||
    org.includes('hosting') ||
    org.includes('server') ||
    org.includes('datacenter')
  ) {
    return 'Datacenter'
  }
  return 'Residential ISP'
}

// Route origin classification
const classifyRouteOrigin = (asnType, orgName) => {
  const org = (orgName || '').toLowerCase()
  if (asnType === 'Datacenter') {
    if (
      org.includes('cloudflare') ||
      org.includes('akamai') ||
      org.includes('fastly')
    ) {
      return 'CDN Edge'
    }
    return 'Cloud Hosted'
  }
  if (asnType === 'Mobile Carrier') return 'Mobile Network'
  if (org.includes('satellite')) return 'Satellite'
  return 'Direct ISP'
}

// Network health score computation
const computeNetworkHealthScore = (
  networkTier,
  asnType,
  bgpStatus,
  routeOrigin
) => {
  let score = 50

  // Tier scoring
  if (networkTier === 'Tier 1') score += 30
  else if (networkTier === 'Tier 2') score += 20
  else if (networkTier === 'Tier 3') score += 10

  // ASN type scoring
  if (asnType === 'Residential ISP') score += 15
  else if (asnType === 'Mobile Carrier') score += 10
  else if (asnType === 'Datacenter') score += 5
  else if (asnType === 'Education') score += 12

  // BGP status scoring
  if (bgpStatus === 'active') score += 5

  return Math.min(100, Math.max(0, score))
}

// Registry classification
const classifyRegistry = (countryCode) => {
  const afrinic = [
    'NG', 'ZA', 'GH', 'KE', 'EG', 'MA',
    'TN', 'DZ', 'ET', 'TZ', 'UG', 'SN',
    'CI', 'CM', 'AO', 'MZ', 'MG', 'ZW',
    'ZM', 'SD', 'LY', 'SO', 'RW', 'BJ'
  ]
  const arin = [
    'US', 'CA', 'MX', 'AG', 'AI', 'AN',
    'AW', 'BB', 'BL', 'BM', 'BS', 'BZ',
    'CR', 'CU', 'DM', 'DO', 'GD', 'GP'
  ]
  const ripe = [
    'GB', 'DE', 'FR', 'IT', 'ES', 'NL',
    'RU', 'PL', 'SE', 'NO', 'DK', 'FI',
    'CH', 'AT', 'BE', 'PT', 'GR', 'CZ',
    'HU', 'RO', 'UA', 'TR', 'SA', 'AE'
  ]
  const apnic = [
    'CN', 'JP', 'IN', 'AU', 'KR', 'ID',
    'PK', 'BD', 'PH', 'VN', 'TH', 'MY',
    'SG', 'NZ', 'TW', 'HK', 'MN', 'KH'
  ]
  const lacnic = [
    'BR', 'AR', 'CL', 'CO', 'PE', 'VE',
    'EC', 'BO', 'PY', 'UY', 'GY', 'SR'
  ]

  if (afrinic.includes(countryCode)) return 'AFRINIC'
  if (arin.includes(countryCode)) return 'ARIN'
  if (ripe.includes(countryCode)) return 'RIPE NCC'
  if (apnic.includes(countryCode)) return 'APNIC'
  if (lacnic.includes(countryCode)) return 'LACNIC'
  return 'ARIN'
}

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

// Fetch deep ASN intelligence from ipwho.is
const fetchDeepIntelligence = async () => {
  const response = await fetchWithTimeout(
    'https://ipwho.is/',
    {},
    7000
  )
  if (!response.ok) {
    throw new Error(
      `Primary deep fetch failed: ${response.status}`
    )
  }
  const data = await response.json()
  if (!data.ip) {
    throw new Error('No IP in deep response')
  }
  return data
}

// Fallback deep fetch from ip-api.com
const fetchDeepIntelligenceFallback = async () => {
  const response = await fetchWithTimeout(
    'https://ip-api.com/json/?fields=66846719',
    {},
    7000
  )
  if (!response.ok) {
    throw new Error(
      `Fallback deep fetch failed: ${response.status}`
    )
  }
  const data = await response.json()
  if (data.status === 'fail') {
    throw new Error(
      `Fallback error: ${data.message}`
    )
  }
  return data
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

  let rawData = null
  let dataSource = null

  // Try primary then fallback
  try {
    rawData = await fetchDeepIntelligence()
    dataSource = 'primary'
  } catch (primaryError) {
    try {
      rawData = await fetchDeepIntelligenceFallback()
      dataSource = 'fallback'
    } catch (fallbackError) {
      return res.status(503).json({
        success: false,
        error: 'All deep intelligence sources failed',
        details: {
          primary: primaryError.message,
          fallback: fallbackError.message
        },
        timestamp: new Date().toISOString(),
        responseTime: (Date.now() - startTime) + 'ms'
      })
    }
  }

  // Extract ASN number
  const rawAsn = rawData.connection?.asn ||
    rawData.as?.replace(/[^0-9]/g, '') ||
    null

  const asnNumber = rawAsn
    ? parseInt(rawAsn, 10)
    : null

  // Extract organization name
  const orgName = rawData.connection?.org ||
    rawData.connection?.isp ||
    rawData.org ||
    rawData.isp ||
    null

  // Extract country code
  const countryCode = rawData.country_code ||
    rawData.countryCode ||
    null

  // Run all classifications
  const asnType = classifyAsnType(asnNumber, orgName)
  const networkTier = classifyNetworkTier(
    asnNumber,
    orgName
  )
  const routeOrigin = classifyRouteOrigin(
    asnType,
    orgName
  )
  const allocationRegistry = classifyRegistry(
    countryCode
  )
  const bgpRouteStatus = 'active'
  const networkHealthScore = computeNetworkHealthScore(
    networkTier,
    asnType,
    bgpRouteStatus,
    routeOrigin
  )

  // Known datacenter detection
  const knownDatacenter = DATACENTER_ASNS[asnNumber]
    || null

  // Known mobile carrier detection
  const knownMobileCarrier = MOBILE_ASNS[asnNumber]
    || null

  // Build IP range estimate
  const ipParts = (rawData.ip || '').split('.')
  const ipRange = ipParts.length === 4
    ? `${ipParts[0]}.${ipParts[1]}.0.0/16`
    : null

  // Estimate peering count from tier
  const estimatedPeeringCount = networkTier === 'Tier 1'
    ? '100+'
    : networkTier === 'Tier 2'
    ? '20-100'
    : '1-20'

  // Upstream provider inference
  const upstreamProvider = networkTier === 'Tier 3'
    ? 'Regional upstream provider'
    : networkTier === 'Tier 2'
    ? 'Tier 1 transit provider'
    : 'Direct internet exchange'

  const responseTime = Date.now() - startTime

  return res.status(200).json({
    success: true,
    data: {
      // Core ASN data
      asn: asnNumber ? `AS${asnNumber}` : null,
      asnNumber: asnNumber,
      asnOwner: knownDatacenter ||
        knownMobileCarrier ||
        orgName,
      asnType: asnType,
      knownProvider: knownDatacenter ||
        knownMobileCarrier ||
        null,

      // Network classification
      networkTier: networkTier,
      routeOrigin: routeOrigin,
      allocationRegistry: allocationRegistry,
      bgpRouteStatus: bgpRouteStatus,
      networkAnnouncementStatus: 'announced',

      // Network topology
      ipRange: ipRange,
      estimatedPeeringCount: estimatedPeeringCount,
      upstreamProvider: upstreamProvider,

      // Scores
      networkHealthScore: networkHealthScore,

      // Raw enrichment
      rawOrg: orgName,
      countryCode: countryCode,

      // Meta
      fetchedAt: new Date().toISOString(),
      responseTime: responseTime + 'ms',
      dataSource: dataSource
    }
  })
}
