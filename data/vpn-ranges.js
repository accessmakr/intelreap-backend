// Known VPN and proxy provider
// organization name patterns
// Used for ASN org name matching
// Zero API calls required
// Updated periodically

const VPN_PROVIDER_PATTERNS = [
  // Major commercial VPN providers
  'nordvpn',
  'expressvpn',
  'surfshark',
  'cyberghost',
  'ipvanish',
  'purevpn',
  'protonvpn',
  'proton vpn',
  'mullvad',
  'private internet access',
  'pia vpn',
  'tunnelbear',
  'windscribe',
  'hidemyass',
  'hma vpn',
  'vyprvpn',
  'strongvpn',
  'hotspot shield',
  'zenmate',
  'avast vpn',
  'avast secureline',
  'norton vpn',
  'norton secure vpn',
  'mcafee vpn',
  'kaspersky vpn',
  'bitdefender vpn',
  'eset vpn',
  'f-secure vpn',
  'ivacy',
  'hide.me',
  'astrill',
  'airvpn',
  'perfectprivacy',
  'perfect privacy',
  'trust.zone',
  'vpn unlimited',
  'keepsolid',
  'torguard',
  'bolehvpn',
  'ovpn',
  'azirevpn',
  'cryptostorm',
  'cactus vpn',
  'vpnsecure',
  'vpn.ac',
  'slickvpn',
  'safer vpn',
  'safervpn',
  'goose vpn',
  'goosevpn',
  'urban vpn',
  'urbanvpn',
  'speedify',
  'warp',
  'cloudflare warp',

  // Corporate VPN solutions
  'cisco vpn',
  'cisco anyconnect',
  'pulse secure',
  'palo alto globalprotect',
  'fortinet vpn',
  'fortivpn',
  'sonicwall vpn',
  'juniper vpn',
  'checkpoint vpn',
  'f5 vpn',
  'citrix vpn',
  'zscaler',

  // Generic VPN indicators in org names
  'vpn',
  'virtual private',
  'anonymizer',
  'anonymous vpn',
  'vpn service',
  'vpn provider',
  'vpn network',
  'vpn hosting',
  'vpn server',
  'vpn gateway',
  'vpn infrastructure',

  // TOR network indicators
  'tor exit',
  'tor node',
  'tor relay',
  'torproject',
  'onion routing',
  'anonymous proxy',
  'exit node',
  'anonymizing proxy',

  // Proxy service indicators
  'proxy',
  'proxies',
  'proxy service',
  'proxy network',
  'proxy server',
  'proxy provider',
  'rotating proxy',
  'residential proxy',
  'datacenter proxy',
  'backconnect proxy',
  'oxylabs',
  'brightdata',
  'bright data',
  'luminati',
  'smartproxy',
  'soax',
  'geosurf',
  'netnut',
  'packetstream',
  'iproyal',
  'rayobyte',
  'stormproxies',
  'shifter',
  'infatica',
  'hydraproxy',
  'froxy',
  'webshare',
  'proxy-cheap',
  'proxycheap',
  'proxyrack',
  'proxyempire',
  'proxybulk',

  // Known hosting providers used by VPNs
  'm247',
  'leaseweb',
  'serverius',
  'coltfrance',
  'euserv',
  'frantech',
  'buyvm',
  'datawire',
  'datacamp',
  'fdcservers',
  'quadranet',
  'colocation america',
  'psychz',
  'sharktech',
  'tzulo',
  'nocix',
  'reliablesite',
  'hostus',
  'edgewebhosting',
  'velia.net',
  'velia',
  'serverplan',
  'combahton',
  'globaltelehost',
  'global telehost',
  'performive',
  'wholesaleinternet',
  'wholesale internet',
  'nexusbytes',
  'hostcram',
  'baxet',
  'alexhost',
  'abuseipdb',
  'inferno solutions',
  'xfernet',
  'serveraxis',
  'oplink',
  'intergrid',
  'ipxo',
  'as209',
  'serverstack'
]

// Hosting and datacenter provider patterns
// These indicate commercial hosting
// not necessarily VPN but suspicious
const HOSTING_PROVIDER_PATTERNS = [
  // Major clouds already in asn-database
  // These are additional hosting indicators
  'dedicated server',
  'dedicated hosting',
  'vps hosting',
  'cloud hosting',
  'web hosting',
  'managed hosting',
  'colocation',
  'colo',
  'server farm',
  'data center',
  'datacenter',
  'internet exchange',
  'peering',
  'transit',
  'ix ',
  'ixp',
  'network operations',
  'noc',
  'backbone',
  'carrier neutral',
  'carrier-neutral',
  'anycast',
  'bgp',
  'autonomous system'
]

// Residential ISP positive indicators
// Presence of these suggests legitimate
// residential connection
const RESIDENTIAL_INDICATORS = [
  'residential',
  'broadband',
  'fiber',
  'fibre',
  'cable',
  'dsl',
  'adsl',
  'vdsl',
  'fttx',
  'ftth',
  'fttp',
  'gpon',
  'xdsl',
  'internet service provider',
  'isp',
  'telecommunications',
  'telecom',
  'telefonica',
  'telefonika',
  'telephone',
  'telenet',
  'comcast',
  'spectrum',
  'cox ',
  'centurylink',
  'lumen',
  'att ',
  'at&t',
  'verizon fios',
  'verizon home',
  'charter',
  'altice',
  'optimum',
  'cablevision',
  'mediacom',
  'suddenlink',
  'consolidated',
  'windstream',
  'frontier'
]

// Check if org name matches VPN patterns
const isVPNProvider = (orgName) => {
  const org = (orgName || '').toLowerCase()
  return VPN_PROVIDER_PATTERNS.some(
    pattern => org.includes(pattern)
  )
}

// Check if org name matches
// hosting provider patterns
const isHostingProvider = (orgName) => {
  const org = (orgName || '').toLowerCase()
  return HOSTING_PROVIDER_PATTERNS.some(
    pattern => org.includes(pattern)
  )
}

// Check if org name suggests
// residential connection
const isResidentialISP = (orgName) => {
  const org = (orgName || '').toLowerCase()
  return RESIDENTIAL_INDICATORS.some(
    pattern => org.includes(pattern)
  )
}

// Get VPN risk level from org name
const getVPNRiskLevel = (orgName) => {
  const org = (orgName || '').toLowerCase()

  // Check for explicit VPN provider
  const isVPN = isVPNProvider(org)
  if (isVPN) {
    // Check if it is a known major VPN
    const majorVPNs = [
      'nordvpn', 'expressvpn', 'surfshark',
      'cyberghost', 'ipvanish', 'purevpn',
      'protonvpn', 'mullvad',
      'private internet access'
    ]
    const isMajorVPN = majorVPNs.some(
      v => org.includes(v)
    )
    return {
      level: 'high',
      isKnownVPN: true,
      isMajorVPN: isMajorVPN
    }
  }

  // Check for hosting
  const isHosting = isHostingProvider(org)
  if (isHosting) {
    return {
      level: 'medium',
      isKnownVPN: false,
      isMajorVPN: false
    }
  }

  // Check for residential
  const isResidential = isResidentialISP(org)
  if (isResidential) {
    return {
      level: 'low',
      isKnownVPN: false,
      isMajorVPN: false
    }
  }

  return {
    level: 'unknown',
    isKnownVPN: false,
    isMajorVPN: false
  }
}

// Analyze full org name
// Returns complete classification
const analyzeOrgName = (orgName) => {
  const riskLevel = getVPNRiskLevel(orgName)

  return {
    orgName: orgName,
    isVPNProvider: riskLevel.isKnownVPN,
    isMajorVPNProvider: riskLevel.isMajorVPN,
    isHostingProvider: isHostingProvider(orgName),
    isResidentialISP: isResidentialISP(orgName),
    riskLevel: riskLevel.level,
    classification: riskLevel.isKnownVPN
      ? 'VPN Provider'
      : isHostingProvider(orgName)
      ? 'Hosting Provider'
      : isResidentialISP(orgName)
      ? 'Residential ISP'
      : 'Unknown'
  }
}

module.exports = {
  VPN_PROVIDER_PATTERNS,
  HOSTING_PROVIDER_PATTERNS,
  RESIDENTIAL_INDICATORS,
  isVPNProvider,
  isHostingProvider,
  isResidentialISP,
  getVPNRiskLevel,
  analyzeOrgName
}
