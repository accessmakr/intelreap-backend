const fetch = require('node-fetch')
const cache = require('./cache')

// Cache keys for PeeringDB data
const PEERINGDB_CACHE_KEY = 'peeringdb:networks'
const PEERINGDB_INDEX_KEY = 'peeringdb:asn-index'
const PEERINGDB_TTL = 604800 // 7 days

// Network type mappings from PeeringDB
const PEERINGDB_TYPE_MAP = {
  'NSP': 'Tier 1 Backbone',
  'Content': 'Content Provider',
  'Cable/DSL/ISP': 'Residential ISP',
  'Enterprise': 'Enterprise',
  'Educational/Research': 'Education',
  'Non-Profit': 'Non-Profit',
  'Route Server': 'Internet Exchange',
  'Government': 'Government'
}

// Traffic level mappings from PeeringDB
const TRAFFIC_TIER_MAP = {
  '100+Tbps': 1,
  '10-100Tbps': 1,
  '1-10Tbps': 1,
  '100Gbps-1Tbps': 2,
  '10-100Gbps': 2,
  '1-10Gbps': 2,
  '100-1000Mbps': 3,
  '10-100Mbps': 3,
  'Under 10Mbps': 3
}

// Org name pattern classification
// Used when no database match exists
const ORG_PATTERNS = {
  satellite: [
    'starlink', 'viasat', 'hughesnet',
    'satellite', 'spacex', 'intelsat',
    'ses ', 'eutelsat', 'teledesic',
    'orbit', 'oneweb'
  ],
  education: [
    'university', 'college', 'school',
    'institute', 'academic', 'research',
    'edu', 'campus', 'polytechnic',
    'faculty', 'laboratory', 'conseil',
    'wissenschaft', 'academie'
  ],
  government: [
    'government', 'federal', 'ministry',
    'military', 'defense', 'defence',
    'agency', 'municipal', 'national',
    'parliament', 'senate', 'bureau',
    'department', 'commission', 'police',
    'army', 'navy', 'force', 'intelligence'
  ],
  mobile: [
    'mobile', 'wireless', 'cellular',
    'telecom', 'telefon', 'telephone',
    'gsm', 'lte', '4g', '5g', 'mvno',
    'sprint', 'verizon', 'vodafone',
    'orange', 'tmobile', 't-mobile',
    'airtel', 'mtn', 'glo', 'etisalat',
    'zain', 'safaricom', 'tigo'
  ],
  datacenter: [
    'cloud', 'hosting', 'server',
    'datacenter', 'data center',
    'colocation', 'colo', 'dedicated',
    'vps', 'virtual private', 'managed',
    'infrastructure', 'platform'
  ],
  cdn: [
    'cdn', 'delivery', 'akamai',
    'cloudflare', 'fastly', 'cloudfront',
    'limelight', 'edgecast', 'stackpath',
    'keycdn', 'bunny', 'b-cdn'
  ],
  isp: [
    'internet', 'broadband', 'fiber',
    'fibre', 'cable', 'dsl', 'adsl',
    'network', 'communications',
    'connect', 'access', 'service'
  ]
}

// Fetch PeeringDB data from cache
const getPeeringDBFromCache = async () => {
  try {
    const cached = await cache.get(
      PEERINGDB_CACHE_KEY
    )
    return cached
  } catch (error) {
    return null
  }
}

// Look up single ASN in PeeringDB cache
const lookupASNInPeeringDB = async (asnNumber) => {
  try {
    const indexKey = `${PEERINGDB_INDEX_KEY}:${asnNumber}`
    const cached = await cache.get(indexKey)
    return cached
  } catch (error) {
    return null
  }
}

// Fetch live PeeringDB data for specific ASN
// Used as real time fallback
const fetchPeeringDBASN = async (asnNumber) => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      5000
    )

    const response = await fetch(
      `https://www.peeringdb.com/api/net?asn=${asnNumber}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'IntelreapService/1.0',
          'Accept': 'application/json'
        }
      }
    )

    clearTimeout(timeout)

    if (!response.ok) return null

    const data = await response.json()

    if (
      !data.data ||
      data.data.length === 0
    ) return null

    const network = data.data[0]

    // Cache this individual result
    const cacheKey =
      `${PEERINGDB_INDEX_KEY}:${asnNumber}`
    await cache.set(
      cacheKey,
      network,
      PEERINGDB_TTL
    )

    return network

  } catch (error) {
    return null
  }
}

// Fetch BGP.tools classification
// For ASNs not in PeeringDB
const fetchBGPTools = async (asnNumber) => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      5000
    )

    const response = await fetch(
      `https://bgp.tools/as/${asnNumber}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'IntelreapService/1.0',
          'Accept': 'application/json'
        }
      }
    )

    clearTimeout(timeout)

    if (!response.ok) return null

    // BGP.tools returns HTML by default
    // Parse what we need
    const text = await response.text()

    // Extract name from page
    const nameMatch = text.match(
      /<title>AS\d+ ([^<]+)<\/title>/
    )
    const name = nameMatch
      ? nameMatch[1].trim()
      : null

    if (!name) return null

    return {
      name: name,
      source: 'bgptools'
    }

  } catch (error) {
    return null
  }
}

// Pattern based classification
// Works for any org name
const classifyByPattern = (orgName) => {
  const org = (orgName || '').toLowerCase()

  for (const [category, patterns] of
    Object.entries(ORG_PATTERNS)
  ) {
    if (patterns.some(p => org.includes(p))) {
      switch (category) {
        case 'satellite':
          return {
            type: 'Satellite',
            tier: 3,
            category: 'satellite'
          }
        case 'education':
          return {
            type: 'Education',
            tier: 2,
            category: 'education'
          }
        case 'government':
          return {
            type: 'Government',
            tier: 2,
            category: 'government'
          }
        case 'mobile':
          return {
            type: 'Mobile Carrier',
            tier: 3,
            category: 'mobile'
          }
        case 'datacenter':
          return {
            type: 'Datacenter',
            tier: 2,
            category: 'datacenter'
          }
        case 'cdn':
          return {
            type: 'CDN Provider',
            tier: 2,
            category: 'cdn'
          }
        case 'isp':
          return {
            type: 'Residential ISP',
            tier: 3,
            category: 'residential'
          }
      }
    }
  }

  return {
    type: 'Residential ISP',
    tier: 3,
    category: 'residential'
  }
}

// Classify using ip-api.com hosting flag
// The most reliable residential vs
// datacenter signal available for free
const classifyFromIPAPIFlags = (flags) => {
  if (!flags) return null

  const {
    hosting,
    mobile,
    proxy,
    org,
    isp,
    as: asn
  } = flags

  if (proxy) {
    return {
      type: 'Proxy/VPN',
      tier: 2,
      category: 'proxy',
      source: 'ipapi-flags'
    }
  }

  if (hosting) {
    return {
      type: 'Datacenter',
      tier: 2,
      category: 'datacenter',
      source: 'ipapi-flags'
    }
  }

  if (mobile) {
    return {
      type: 'Mobile Carrier',
      tier: 3,
      category: 'mobile',
      source: 'ipapi-flags'
    }
  }

  // Not hosting, not mobile, not proxy
  // Definitively residential
  return {
    type: 'Residential ISP',
    tier: 3,
    category: 'residential',
    source: 'ipapi-flags'
  }
}

// Main ASN classification engine
// Tries all sources in priority order
const classifyASN = async (
  asnNumber,
  orgName,
  ipAPIFlags
) => {
  const num = parseInt(
    String(asnNumber || '')
      .replace(/[^0-9]/g, ''),
    10
  )

  // PRIORITY 1
  // ip-api.com flags are most reliable
  // for residential vs datacenter split
  if (ipAPIFlags) {
    const flagResult =
      classifyFromIPAPIFlags(ipAPIFlags)
    if (flagResult) {
      // Enrich with org name from pattern
      const patternResult =
        classifyByPattern(orgName)

      return {
        ...flagResult,
        provider: orgName || 'Unknown',
        patternType: patternResult.type,
        confidence: 'high',
        source: 'ipapi-flags'
      }
    }
  }

  // PRIORITY 2
  // Check PeeringDB cache
  // Rich classification for known networks
  if (num) {
    const peeringData =
      await lookupASNInPeeringDB(num)

    if (peeringData) {
      const networkType =
        PEERINGDB_TYPE_MAP[peeringData.info_type] ||
        'Residential ISP'

      const tier = peeringData.info_traffic
        ? (TRAFFIC_TIER_MAP[
            peeringData.info_traffic
          ] || 3)
        : 3

      return {
        type: networkType,
        provider: peeringData.name || orgName,
        tier: tier,
        category: networkType
          .toLowerCase()
          .replace(/\//g, '-')
          .replace(/ /g, '-'),
        isKnown: true,
        confidence: 'high',
        source: 'peeringdb-cache',
        peeringdbId: peeringData.id,
        website: peeringData.website || null,
        traffic: peeringData.info_traffic || null,
        prefixes4:
          peeringData.info_prefixes4 || null,
        prefixes6:
          peeringData.info_prefixes6 || null,
        policyGeneral:
          peeringData.policy_general || null
      }
    }

    // PRIORITY 3
    // Fetch live from PeeringDB
    // For ASNs not yet in our cache
    const livePeeringData =
      await fetchPeeringDBASN(num)

    if (livePeeringData) {
      const networkType =
        PEERINGDB_TYPE_MAP[
          livePeeringData.info_type
        ] || 'Residential ISP'

      const tier = livePeeringData.info_traffic
        ? (TRAFFIC_TIER_MAP[
            livePeeringData.info_traffic
          ] || 3)
        : 3

      return {
        type: networkType,
        provider: livePeeringData.name || orgName,
        tier: tier,
        category: networkType
          .toLowerCase()
          .replace(/\//g, '-')
          .replace(/ /g, '-'),
        isKnown: true,
        confidence: 'high',
        source: 'peeringdb-live',
        traffic:
          livePeeringData.info_traffic || null,
        prefixes4:
          livePeeringData.info_prefixes4 || null
      }
    }

    // PRIORITY 4
    // BGP.tools for edge cases
    const bgpData = await fetchBGPTools(num)
    if (bgpData) {
      const patternResult = classifyByPattern(
        bgpData.name
      )
      return {
        ...patternResult,
        provider: bgpData.name || orgName,
        confidence: 'medium',
        source: 'bgptools'
      }
    }
  }

  // PRIORITY 5
  // Pattern matching on org name
  // Always available, never fails
  const patternResult = classifyByPattern(orgName)
  return {
    ...patternResult,
    provider: orgName || 'Unknown Provider',
    isKnown: false,
    confidence: 'low',
    source: 'pattern-matching'
  }
}

// Synchronous classification
// No async calls
// Used when speed is critical
const classifyASNSync = (asnNumber, orgName) => {
  const patternResult = classifyByPattern(orgName)
  return {
    ...patternResult,
    provider: orgName || 'Unknown Provider',
    isKnown: false,
    confidence: 'low',
    source: 'pattern-matching-sync'
  }
}

// Registry lookup from country code
const getRegistry = (countryCode) => {
  const AFRINIC = [
    'NG', 'ZA', 'GH', 'KE', 'EG', 'MA',
    'TN', 'DZ', 'ET', 'TZ', 'UG', 'SN',
    'CI', 'CM', 'AO', 'MZ', 'MG', 'ZW',
    'ZM', 'SD', 'LY', 'SO', 'RW', 'BJ',
    'ML', 'BF', 'NE', 'TD', 'GN', 'MR',
    'SL', 'TG', 'BW', 'NA', 'LS', 'SZ',
    'ER', 'DJ', 'GM', 'GW', 'ST', 'CV',
    'KM', 'MU', 'SC', 'CG', 'CD', 'GA',
    'GQ', 'CF', 'BI', 'MW', 'LR', 'GN'
  ]
  const ARIN = [
    'US', 'CA', 'MX', 'AG', 'AI', 'AN',
    'AW', 'BB', 'BL', 'BM', 'BS', 'BZ',
    'CR', 'CU', 'DM', 'DO', 'GD', 'GP',
    'GT', 'HN', 'HT', 'JM', 'KN', 'KY',
    'LC', 'MF', 'MQ', 'MS', 'NI', 'PA',
    'PR', 'SV', 'TC', 'TT', 'VC', 'VG', 'VI'
  ]
  const RIPE = [
    'GB', 'DE', 'FR', 'IT', 'ES', 'NL',
    'RU', 'PL', 'SE', 'NO', 'DK', 'FI',
    'CH', 'AT', 'BE', 'PT', 'GR', 'CZ',
    'HU', 'RO', 'UA', 'TR', 'SA', 'AE',
    'IL', 'IQ', 'IR', 'JO', 'KW', 'LB',
    'OM', 'QA', 'SY', 'YE', 'BH', 'BY',
    'MD', 'LT', 'LV', 'EE', 'SK', 'SI',
    'HR', 'BA', 'RS', 'ME', 'MK', 'AL',
    'BG', 'GE', 'AM', 'AZ', 'KZ', 'UZ',
    'TM', 'KG', 'TJ', 'AF', 'PK', 'IS',
    'LU', 'LI', 'MC', 'SM', 'VA', 'AD',
    'MT', 'CY', 'MK', 'XK'
  ]
  const APNIC = [
    'CN', 'JP', 'IN', 'AU', 'KR', 'ID',
    'PH', 'VN', 'TH', 'MY', 'SG', 'NZ',
    'TW', 'HK', 'MN', 'KH', 'LA', 'MM',
    'NP', 'LK', 'MV', 'BT', 'FJ', 'PG',
    'SB', 'VU', 'WS', 'TO', 'KI', 'TV',
    'NR', 'PW', 'FM', 'MH', 'BD'
  ]
  const LACNIC = [
    'BR', 'AR', 'CL', 'CO', 'PE', 'VE',
    'EC', 'BO', 'PY', 'UY', 'GY', 'SR',
    'FK', 'GF', 'TF', 'CW', 'BQ', 'SX'
  ]

  const code = (countryCode || '').toUpperCase()

  if (AFRINIC.includes(code)) return 'AFRINIC'
  if (ARIN.includes(code)) return 'ARIN'
  if (RIPE.includes(code)) return 'RIPE NCC'
  if (APNIC.includes(code)) return 'APNIC'
  if (LACNIC.includes(code)) return 'LACNIC'
  return 'ARIN'
}

// Compute network health score
const computeNetworkHealth = (
  tier,
  type,
  bgpStatus,
  prefixCount
) => {
  let score = 40

  switch (tier) {
    case 1: score += 35; break
    case 2: score += 20; break
    case 3: score += 10; break
  }

  if (type === 'Residential ISP') score += 15
  if (type === 'Education') score += 12
  if (type === 'Tier 1 Backbone') score += 20
  if (type === 'Content Provider') score += 10
  if (bgpStatus === 'active') score += 5

  // More prefixes = more established network
  if (prefixCount) {
    if (prefixCount > 1000) score += 5
    else if (prefixCount > 100) score += 3
    else if (prefixCount > 10) score += 1
  }

  return Math.min(100, Math.max(0, score))
}

// Get human readable tier label
const getTierLabel = (tier) => {
  switch (tier) {
    case 1:
      return 'Tier 1 — Global Backbone'
    case 2:
      return 'Tier 2 — Regional Provider'
    case 3:
      return 'Tier 3 — Local Provider'
    default:
      return 'Tier 3 — Local Provider'
  }
}

// Estimate peering count from tier
// and prefix count
const estimatePeeringCount = (
  tier,
  prefixCount
) => {
  if (prefixCount) {
    if (prefixCount > 10000) return '1000+'
    if (prefixCount > 1000) return '100-1000'
    if (prefixCount > 100) return '10-100'
    return '1-10'
  }

  switch (tier) {
    case 1: return '500+'
    case 2: return '50-500'
    case 3: return '1-50'
    default: return '1-50'
  }
}

// Get upstream provider description
const getUpstreamProvider = (tier, type) => {
  if (tier === 1) {
    return 'Direct internet exchange peering'
  }
  if (
    type === 'CDN Provider' ||
    type === 'Content Provider'
  ) {
    return 'Multiple Tier 1 backbone providers'
  }
  if (tier === 2) {
    return 'Tier 1 transit provider'
  }
  return 'Regional transit provider'
}

module.exports = {
  classifyASN,
  classifyASNSync,
  getRegistry,
  getTierLabel,
  estimatePeeringCount,
  getUpstreamProvider,
  computeNetworkHealth,
  classifyByPattern,
  classifyFromIPAPIFlags,
  ORG_PATTERNS,
  PEERINGDB_CACHE_KEY,
  PEERINGDB_INDEX_KEY,
  PEERINGDB_TTL
}
