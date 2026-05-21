const cache = require('./cache')

// Known bot and scraper user agent patterns
const BOT_PATTERNS = [
  // Generic bots
  /bot/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /crawling/i,

  // HTTP clients and tools
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /python-urllib/i,
  /go-http-client/i,
  /java\//i,
  /apache-httpclient/i,
  /okhttp/i,
  /axios/i,
  /node-fetch/i,
  /got\//i,
  /superagent/i,
  /request\//i,
  /urllib/i,
  /httpie/i,
  /pycurl/i,
  /libwww-perl/i,
  /lwp-trivial/i,

  // Headless browsers
  /headlesschrome/i,
  /phantomjs/i,
  /selenium/i,
  /webdriver/i,
  /puppeteer/i,
  /playwright/i,
  /cypress/i,
  /nightwatch/i,

  // Security scanners
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /nuclei/i,
  /sqlmap/i,
  /dirbuster/i,
  /gobuster/i,
  /burpsuite/i,
  /nessus/i,
  /openvas/i,
  /acunetix/i,

  // Known scraping frameworks
  /scrapy/i,
  /beautifulsoup/i,
  /mechanize/i,
  /httpclient/i,

  // AI training scrapers
  /gptbot/i,
  /chatgpt-user/i,
  /ccbot/i,
  /claudebot/i,
  /anthropic-ai/i,
  /cohere-ai/i,
  /openai/i,
  /bytespider/i,
  /amazonbot/i,
  /diffbot/i,
  /semrushbot/i,
  /ahrefsbot/i,
  /mj12bot/i,

  // Empty or suspicious
  /^$/,
  /^-$/,
  /^null$/i,
  /^none$/i,
  /^test$/i
]

// Legitimate browser patterns
// These always pass regardless
const LEGITIMATE_PATTERNS = [
  /mozilla\/5\.0/i,
  /applewebkit/i,
  /gecko\//i,
  /chrome\//i,
  /safari\//i,
  /firefox\//i,
  /edge\//i,
  /opr\//i,
  /opera\//i
]

// Allowed origins for API access
const ALLOWED_ORIGINS = [
  'https://intelreap.com',
  'https://www.intelreap.com',
  'https://intelreap-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500'
]

// Suspicious header combinations
const SUSPICIOUS_HEADER_PATTERNS = [
  // Accept header too simple
  // Real browsers send complex accept headers
  (headers) => {
    const accept = headers['accept'] || ''
    return accept === '*/*' &&
      !headers['accept-language']
  },

  // No accept-encoding (all browsers send this)
  (headers) => {
    return !headers['accept-encoding'] &&
      !headers['accept-language']
  }
]

// Analyze user agent string
const analyzeUserAgent = (userAgent) => {
  if (!userAgent) {
    return {
      isBot: true,
      confidence: 'high',
      reason: 'Missing user agent'
    }
  }

  // Check legitimate patterns first
  const isLegitimate = LEGITIMATE_PATTERNS.some(
    pattern => pattern.test(userAgent)
  )

  if (isLegitimate) {
    // Still check for bot patterns even
    // in legitimate-looking UAs
    // Some bots spoof browser UAs
    const hasEmbeddedBot = BOT_PATTERNS.some(
      pattern => {
        // Skip generic patterns that
        // could match legitimate UAs
        const patternStr = pattern.toString()
        if (
          patternStr.includes('bot') ||
          patternStr.includes('crawler')
        ) {
          return pattern.test(userAgent)
        }
        return false
      }
    )

    if (hasEmbeddedBot) {
      return {
        isBot: true,
        confidence: 'medium',
        reason: 'Bot pattern in browser UA',
        userAgent: userAgent
      }
    }

    return {
      isBot: false,
      confidence: 'high',
      reason: 'Legitimate browser detected',
      userAgent: userAgent
    }
  }

  // Check bot patterns
  const matchedPattern = BOT_PATTERNS.find(
    pattern => pattern.test(userAgent)
  )

  if (matchedPattern) {
    return {
      isBot: true,
      confidence: 'high',
      reason: 'Known bot pattern matched',
      pattern: matchedPattern.toString(),
      userAgent: userAgent
    }
  }

  // Unknown user agent
  // Not clearly legitimate or bot
  return {
    isBot: false,
    confidence: 'low',
    reason: 'Unknown user agent — allowed',
    userAgent: userAgent,
    flagged: true
  }
}

// Validate request origin
const validateOrigin = (req) => {
  const origin = req.headers['origin']
  const referer = req.headers['referer']

  // No origin and no referer
  // Direct API access — suspicious
  if (!origin && !referer) {
    return {
      valid: false,
      reason: 'No origin or referer header',
      confidence: 'medium'
    }
  }

  // Check origin header
  if (origin) {
    const isAllowed = ALLOWED_ORIGINS.some(
      allowed => origin.startsWith(allowed)
    )
    if (isAllowed) {
      return {
        valid: true,
        origin: origin
      }
    }
    return {
      valid: false,
      reason: `Origin not allowed: ${origin}`,
      confidence: 'high'
    }
  }

  // Check referer header
  if (referer) {
    const isAllowed = ALLOWED_ORIGINS.some(
      allowed => referer.startsWith(allowed)
    )
    if (isAllowed) {
      return {
        valid: true,
        referer: referer
      }
    }
    return {
      valid: false,
      reason: `Referer not allowed: ${referer}`,
      confidence: 'medium'
    }
  }

  return {
    valid: false,
    reason: 'Could not validate request source',
    confidence: 'low'
  }
}

// Analyze suspicious headers
const analyzeSuspiciousHeaders = (headers) => {
  const suspiciousFlags = []

  SUSPICIOUS_HEADER_PATTERNS.forEach(
    (check, index) => {
      try {
        if (check(headers)) {
          suspiciousFlags.push(
            `suspicious_header_pattern_${index}`
          )
        }
      } catch (err) {
        // Ignore check errors
      }
    }
  )

  return {
    suspicious: suspiciousFlags.length > 0,
    flags: suspiciousFlags
  }
}

// Main bot detection function
const detect = async (req) => {
  const userAgent =
    req.headers['user-agent'] || ''
  const ip = req.clientIP ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'

  // Check if IP is already flagged
  // as honeypot hit
  const honeypotKey =
    cache.KEYS.honeypot(ip)
  const honeypotHit =
    await cache.exists(honeypotKey)

  if (honeypotHit) {
    return {
      isBot: true,
      confidence: 'high',
      reason: 'IP previously hit honeypot',
      ip: ip,
      action: 'block'
    }
  }

  // Analyze user agent
  const uaAnalysis = analyzeUserAgent(userAgent)

  // Validate origin
  const originValidation = validateOrigin(req)

  // Analyze headers
  const headerAnalysis =
    analyzeSuspiciousHeaders(req.headers)

  // Compute overall bot score
  let botScore = 0
  const flags = []

  if (uaAnalysis.isBot) {
    botScore += uaAnalysis.confidence === 'high'
      ? 80 : 50
    flags.push(uaAnalysis.reason)
  }

  if (!originValidation.valid) {
    botScore += originValidation.confidence === 'high'
      ? 40
      : originValidation.confidence === 'medium'
      ? 20
      : 10
    flags.push(originValidation.reason)
  }

  if (headerAnalysis.suspicious) {
    botScore += 20
    flags.push(...headerAnalysis.flags)
  }

  // Determine action based on score
  let action = 'allow'
  let isBot = false

  if (botScore >= 80) {
    action = 'block'
    isBot = true
  } else if (botScore >= 40) {
    action = 'flag'
    isBot = false
  }

  return {
    isBot: isBot,
    botScore: botScore,
    confidence: botScore >= 80 ? 'high'
      : botScore >= 40 ? 'medium'
      : 'low',
    action: action,
    flags: flags,
    ip: ip,
    userAgent: userAgent,
    uaAnalysis: uaAnalysis,
    originValidation: originValidation,
    headerAnalysis: headerAnalysis
  }
}

// Middleware factory
const createMiddleware = (options = {}) => {
  const {
    blockBots = true,
    logFlags = true,
    allowUnknownOrigin = false
  } = options

  return async (req, res, next) => {
    try {
      const result = await detect(req)

      // Attach detection result to request
      req.botDetection = result

      if (blockBots && result.action === 'block') {
        // Log the block
        if (logFlags) {
          console.log(
            `Bot blocked: ${result.ip} — ` +
            `Score: ${result.botScore} — ` +
            `Reason: ${result.flags.join(', ')}`
          )
        }

        return res.status(403).json({
          error: 'Access denied',
          message: 'Automated access is not permitted'
        })
      }

      // Allow flagged requests through
      // but log them
      if (result.action === 'flag' && logFlags) {
        console.log(
          `Request flagged: ${result.ip} — ` +
          `Score: ${result.botScore} — ` +
          `Flags: ${result.flags.join(', ')}`
        )
      }

      // Handle unknown origin
      if (
        !allowUnknownOrigin &&
        !result.originValidation.valid &&
        result.botScore < 40
      ) {
        // Low bot score but unknown origin
        // Allow but flag for monitoring
        req.unknownOrigin = true
      }

      next()

    } catch (error) {
      // Bot detector failure never
      // blocks legitimate users
      console.error(
        'Bot detector error:',
        error.message
      )
      next()
    }
  }
}

module.exports = {
  detect,
  createMiddleware,
  analyzeUserAgent,
  validateOrigin,
  ALLOWED_ORIGINS,
  BOT_PATTERNS
}
