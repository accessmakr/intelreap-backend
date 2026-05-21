const rateLimiter = require('./rate-limiter')
const botDetector = require('./bot-detector')

// HTTP methods allowed per endpoint
const ALLOWED_METHODS = {
  'health': ['GET', 'OPTIONS'],
  'ip-identity': ['GET', 'OPTIONS'],
  'ip-deep': ['GET', 'OPTIONS'],
  'proxy-intelligence': ['GET', 'OPTIONS'],
  'ai-summary': ['POST', 'OPTIONS'],
  'trap': ['GET', 'POST', 'OPTIONS'],
  'default': ['GET', 'OPTIONS']
}

// Maximum request body size in bytes
const MAX_BODY_SIZE = 1024 * 50 // 50KB

// Required headers for each endpoint
const REQUIRED_HEADERS = {
  'ai-summary': ['content-type'],
  'default': []
}

// Standard CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods':
    'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy':
    'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'geolocation=(), microphone=(), camera=()'
}

// Apply CORS headers to response
const applyCORSHeaders = (res) => {
  Object.entries(CORS_HEADERS).forEach(
    ([key, value]) => res.setHeader(key, value)
  )
}

// Validate request method
const validateMethod = (req, endpoint) => {
  const allowed = ALLOWED_METHODS[endpoint] ||
    ALLOWED_METHODS['default']

  if (!allowed.includes(req.method)) {
    return {
      valid: false,
      status: 405,
      error: 'Method not allowed',
      allowed: allowed
    }
  }

  return { valid: true }
}

// Validate content type for POST requests
const validateContentType = (req) => {
  if (req.method !== 'POST') {
    return { valid: true }
  }

  const contentType =
    req.headers['content-type'] || ''

  if (!contentType.includes('application/json')) {
    return {
      valid: false,
      status: 415,
      error: 'Unsupported media type',
      message: 'Content-Type must be application/json'
    }
  }

  return { valid: true }
}

// Validate request body size
const validateBodySize = (req) => {
  const contentLength =
    parseInt(
      req.headers['content-length'] || '0',
      10
    )

  if (contentLength > MAX_BODY_SIZE) {
    return {
      valid: false,
      status: 413,
      error: 'Request entity too large',
      maxSize: MAX_BODY_SIZE,
      receivedSize: contentLength
    }
  }

  return { valid: true }
}

// Validate required headers
const validateRequiredHeaders = (
  req,
  endpoint
) => {
  const required = REQUIRED_HEADERS[endpoint] ||
    REQUIRED_HEADERS['default']

  const missing = required.filter(
    header => !req.headers[header]
  )

  if (missing.length > 0) {
    return {
      valid: false,
      status: 400,
      error: 'Missing required headers',
      missing: missing
    }
  }

  return { valid: true }
}

// Sanitize query parameters
const sanitizeQueryParams = (query) => {
  const sanitized = {}

  Object.entries(query || {}).forEach(
    ([key, value]) => {
      // Only allow alphanumeric keys
      if (/^[a-zA-Z0-9_-]+$/.test(key)) {
        // Truncate long values
        const sanitizedValue = String(value)
          .substring(0, 200)
          // Remove potential injection characters
          .replace(/[<>'"`;]/g, '')
        sanitized[key] = sanitizedValue
      }
    }
  )

  return sanitized
}

// Main validation pipeline
const validate = async (req, res, endpoint) => {

  // Apply CORS headers immediately
  applyCORSHeaders(res)

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return { valid: false, preflight: true }
  }

  // Step 1 — Method validation
  const methodCheck = validateMethod(
    req,
    endpoint
  )
  if (!methodCheck.valid) {
    res.status(methodCheck.status).json({
      error: methodCheck.error,
      allowedMethods: methodCheck.allowed,
      timestamp: new Date().toISOString()
    })
    return { valid: false }
  }

  // Step 2 — Content type validation
  const contentTypeCheck =
    validateContentType(req)
  if (!contentTypeCheck.valid) {
    res.status(contentTypeCheck.status).json({
      error: contentTypeCheck.error,
      message: contentTypeCheck.message,
      timestamp: new Date().toISOString()
    })
    return { valid: false }
  }

  // Step 3 — Body size validation
  const bodySizeCheck = validateBodySize(req)
  if (!bodySizeCheck.valid) {
    res.status(bodySizeCheck.status).json({
      error: bodySizeCheck.error,
      maxSize: bodySizeCheck.maxSize,
      timestamp: new Date().toISOString()
    })
    return { valid: false }
  }

  // Step 4 — Required headers validation
  const headersCheck = validateRequiredHeaders(
    req,
    endpoint
  )
  if (!headersCheck.valid) {
    res.status(headersCheck.status).json({
      error: headersCheck.error,
      missing: headersCheck.missing,
      timestamp: new Date().toISOString()
    })
    return { valid: false }
  }

  // Step 5 — Rate limit check
  const rateLimitResult = await rateLimiter.check(
    req,
    endpoint
  )
  req.clientIP = rateLimitResult.ip

  // Set rate limit headers
  res.setHeader(
    'X-RateLimit-Limit',
    rateLimiter.RATE_LIMITS[endpoint]?.requests ||
    rateLimiter.RATE_LIMITS['default'].requests
  )
  res.setHeader(
    'X-RateLimit-Remaining',
    rateLimitResult.remaining || 0
  )

  if (!rateLimitResult.allowed) {
    res.setHeader(
      'Retry-After',
      rateLimitResult.retryAfter || 60
    )
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: rateLimitResult.retryAfter || 60,
      message: 'Please slow down your requests',
      timestamp: new Date().toISOString()
    })
    return { valid: false }
  }

  // Step 6 — Bot detection
  const botResult = await botDetector.detect(req)
  req.botDetection = botResult

  if (botResult.action === 'block') {
    console.log(
      `Bot blocked at validator: ` +
      `${botResult.ip} — ` +
      `Score: ${botResult.botScore}`
    )
    res.status(403).json({
      error: 'Access denied',
      message: 'Automated access is not permitted',
      timestamp: new Date().toISOString()
    })
    return { valid: false }
  }

  // Step 7 — Sanitize query params
  req.sanitizedQuery = sanitizeQueryParams(
    req.query
  )

  // All checks passed
  return {
    valid: true,
    ip: req.clientIP,
    botScore: botResult.botScore,
    sanitizedQuery: req.sanitizedQuery
  }
}

module.exports = {
  validate,
  applyCORSHeaders,
  sanitizeQueryParams,
  CORS_HEADERS,
  ALLOWED_METHODS
}
