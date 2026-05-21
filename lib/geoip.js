const maxmind = require('maxmind')
const path = require('path')
const fs = require('fs')

// Database file paths
const DB_DIR = path.join(
  __dirname,
  '..',
  'data',
  'geoip'
)

const CITY_DB_PATH = path.join(
  DB_DIR,
  'GeoLite2-City.mmdb'
)

const ASN_DB_PATH = path.join(
  DB_DIR,
  'GeoLite2-ASN.mmdb'
)

// Database instances
let cityReader = null
let asnReader = null
let initialized = false
let initError = null

// Initialize both database readers
const initialize = async () => {
  if (initialized) return true
  if (initError) return false

  try {
    // Check files exist
    if (!fs.existsSync(CITY_DB_PATH)) {
      throw new Error(
        `City database not found: ${CITY_DB_PATH}`
      )
    }

    if (!fs.existsSync(ASN_DB_PATH)) {
      throw new Error(
        `ASN database not found: ${ASN_DB_PATH}`
      )
    }

    // Open both databases in parallel
    const [city, asn] = await Promise.all([
      maxmind.open(CITY_DB_PATH),
      maxmind.open(ASN_DB_PATH)
    ])

    cityReader = city
    asnReader = asn
    initialized = true

    console.log('MaxMind databases initialized')
    return true

  } catch (error) {
    initError = error.message
    console.error(
      'MaxMind initialization failed:',
      error.message
    )
    return false
  }
}

// Look up city data for an IP
const lookupCity = async (ip) => {
  if (!initialized) {
    await initialize()
  }

  if (!cityReader) return null

  try {
    const result = cityReader.get(ip)
    if (!result) return null

    // Extract and normalize city data
    const country = result.country ||
      result.registered_country || {}
    const city = result.city || {}
    const location = result.location || {}
    const postal = result.postal || {}
    const subdivisions =
      result.subdivisions || []
    const continent = result.continent || {}

    return {
      country: country.names?.en || null,
      countryCode: country.iso_code || null,
      countryIsEU:
        country.is_in_european_union || false,
      continent: continent.names?.en || null,
      continentCode: continent.code || null,
      region: subdivisions[0]?.names?.en || null,
      regionCode:
        subdivisions[0]?.iso_code || null,
      city: city.names?.en || null,
      postal: postal.code || null,
      latitude: location.latitude || null,
      longitude: location.longitude || null,
      timezone: location.time_zone || null,
      accuracyRadius:
        location.accuracy_radius || null,
      source: 'maxmind-local'
    }

  } catch (error) {
    console.error(
      'City lookup failed:',
      error.message
    )
    return null
  }
}

// Look up ASN data for an IP
const lookupASN = async (ip) => {
  if (!initialized) {
    await initialize()
  }

  if (!asnReader) return null

  try {
    const result = asnReader.get(ip)
    if (!result) return null

    return {
      asn: result.autonomous_system_number
        ? `AS${result.autonomous_system_number}`
        : null,
      asnNumber:
        result.autonomous_system_number || null,
      asnOrg:
        result.autonomous_system_organization ||
        null,
      source: 'maxmind-local'
    }

  } catch (error) {
    console.error(
      'ASN lookup failed:',
      error.message
    )
    return null
  }
}

// Combined lookup — city and ASN together
const lookup = async (ip) => {
  if (!initialized) {
    await initialize()
  }

  // Run both lookups in parallel
  const [cityData, asnData] =
    await Promise.all([
      lookupCity(ip),
      lookupASN(ip)
    ])

  if (!cityData && !asnData) {
    return null
  }

  // Determine IP version
  const ipVersion = ip.includes(':')
    ? 'IPv6'
    : 'IPv4'

  // Infer UTC offset from timezone
  const getUTCOffset = (timezone) => {
    if (!timezone) return null
    try {
      const date = new Date()
      const formatter = new Intl.DateTimeFormat(
        'en',
        {
          timeZone: timezone,
          timeZoneName: 'shortOffset'
        }
      )
      const parts = formatter.formatToParts(date)
      const offset = parts.find(
        p => p.type === 'timeZoneName'
      )
      return offset?.value || null
    } catch {
      return null
    }
  }

  // Infer connection type from ASN org name
  const inferConnectionType = (orgName) => {
    const org = (orgName || '').toLowerCase()
    if (
      org.includes('mobile') ||
      org.includes('wireless') ||
      org.includes('cellular') ||
      org.includes('gsm')
    ) return 'mobile'
    if (
      org.includes('fiber') ||
      org.includes('fibre')
    ) return 'fiber'
    if (org.includes('cable')) return 'cable'
    if (org.includes('satellite')) {
      return 'satellite'
    }
    if (
      org.includes('cloud') ||
      org.includes('hosting') ||
      org.includes('datacenter')
    ) return 'datacenter'
    return 'broadband'
  }

  const timezone = cityData?.timezone || null
  const orgName = asnData?.asnOrg || null

  return {
    // IP info
    ipVersion: ipVersion,

    // Location data from City DB
    country: cityData?.country || null,
    countryCode: cityData?.countryCode || null,
    countryIsEU: cityData?.countryIsEU || false,
    continent: cityData?.continent || null,
    continentCode: cityData?.continentCode || null,
    region: cityData?.region || null,
    regionCode: cityData?.regionCode || null,
    city: cityData?.city || null,
    postal: cityData?.postal || null,
    latitude: cityData?.latitude || null,
    longitude: cityData?.longitude || null,
    timezone: timezone,
    utcOffset: getUTCOffset(timezone),
    accuracyRadius: cityData?.accuracyRadius || null,

    // ASN data from ASN DB
    asn: asnData?.asn || null,
    asnNumber: asnData?.asnNumber || null,
    asnOrg: orgName,
    isp: orgName,
    org: orgName,

    // Inferred fields
    connectionType: inferConnectionType(orgName),

    // Metadata
    source: 'maxmind-local',
    responseTimeMs: '<5ms'
  }
}

// Check if databases are available
const isAvailable = () => {
  return initialized &&
    cityReader !== null &&
    asnReader !== null
}

// Get database status
const getStatus = async () => {
  if (!initialized) {
    await initialize()
  }

  const cityExists =
    fs.existsSync(CITY_DB_PATH)
  const asnExists =
    fs.existsSync(ASN_DB_PATH)

  const cityStats = cityExists
    ? fs.statSync(CITY_DB_PATH)
    : null
  const asnStats = asnExists
    ? fs.statSync(ASN_DB_PATH)
    : null

  return {
    initialized: initialized,
    available: isAvailable(),
    error: initError,
    databases: {
      city: {
        exists: cityExists,
        size: cityStats
          ? `${Math.round(
              cityStats.size / 1024 / 1024
            )}MB`
          : null,
        modified: cityStats
          ? cityStats.mtime.toISOString()
          : null
      },
      asn: {
        exists: asnExists,
        size: asnStats
          ? `${Math.round(
              asnStats.size / 1024 / 1024
            )}MB`
          : null,
        modified: asnStats
          ? asnStats.mtime.toISOString()
          : null
      }
    }
  }
}

// Initialize on module load
initialize().catch(err => {
  console.error(
    'Background MaxMind init failed:',
    err.message
  )
})

module.exports = {
  lookup,
  lookupCity,
  lookupASN,
  isAvailable,
  getStatus,
  initialize
}
