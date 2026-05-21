const cache = require('./cache')

// Rate limit configurations per endpoint
const RATE_LIMITS = {
  'health': {
    requests: 60,
    windowSeconds: 60,
    blockDurationSeconds: 300
  },
  'ip-identity': {
    requests: 10,
    windowSeconds: 60,
    blockDurationSeconds: 3600
  },
  'ip-deep': {
    requests: 10,
    windowSeconds: 60,
    blockDurationSeconds: 3600
  },
  'proxy-intelligence': {
    requests: 5,
    windowSeconds: 60,
    blockDurationSeconds: 3600
  },
  'ai-summary': {
    requests: 20,
    windowSeconds: 60,
    blockDurationSeconds: 1800
  },
  'default': {
    requests: 30,
    windowSeconds: 60,
    blockDurationSeconds: 3600
  }
}

// Extract real client IP from request
const extractIP = (req) => {
  const forwardedFor =
    req.headers['x-forwarded-for']
  if (forwardedFor) {
    const ips = forwardedFor
      .split(',')
      .map(ip => ip.trim())
    // First IP is the real client
    const realIP = ips[0]
    // Validate IP format
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
    req.socket?.remoteAddress ||
    'unknown'
  )
}

// Check if IP is currently blocked
const isBlocked = async (ip) => {
  const blockKey = cache.KEYS.botBlock(ip)
  const blocked = await cache.exists(blockKey)
  return blocked
}

// Block an IP address
const blockIP = async (
  ip,
  durationSeconds,
  reason
) => {
  const blockKey = cache.KEYS.botBlock(ip)
  await cache.set(
    blockKey,
    {
      blockedAt: new Date().toISOString(),
      reason: reason,
      duration: durationSeconds
    },
    durationSeconds
  )
}

// Core rate limit check function
const checkRateLimit = async (
  req,
  endpoint
) => {
  const ip = extractIP(req)
  const config = RATE_LIMITS[endpoint] ||
    RATE_LIMITS['default']

  // Check if IP is already blocked
  const blocked = await isBlocked(ip)
  if (blocked) {
    return {
      allowed: false,
      ip: ip,
      reason: 'IP is blocked',
      retryAfter: config.blockDurationSeconds
    }
  }

  // Build rate limit key
  const rateLimitKey = cache.KEYS.rateLimit(
    ip,
    endpoint
  )

  // Increment request counter
  const count = await cache.increment(
    rateLimitKey,
    config.windowSeconds
  )

  // If cache is unavailable allow request
  // Never block users due to cache failure
  if (count === null) {
    return {
      allowed: true,
      ip: ip,
      count: 0,
      limit: config.requests,
      remaining: config.requests,
      cacheUnavailable: true
    }
  }

  const remaining = Math.max(
    0,
    config.requests - count
  )

  // Check if limit exceeded
  if (count > config.requests) {

    // Block IP if significantly over limit
    // Likely a bot or abuser
    if (count > config.requests * 3) {
      await blockIP(
        ip,
        config.blockDurationSeconds,
        `Rate limit exceeded: ${count} requests in ${config.windowSeconds}s on ${endpoint}`
      )
    }

    return {
      allowed: false,
      ip: ip,
      count: count,
      limit: config.requests,
      remaining: 0,
      retryAfter: config.windowSeconds,
      reason: 'Rate limit exceeded'
    }
  }

  return {
    allowed: true,
    ip: ip,
    count: count,
    limit: config.requests,
    remaining: remaining,
    resetIn: config.windowSeconds
  }
}

// Express-style middleware factory
const createMiddleware = (endpoint) => {
  return async (req, res, next) => {
    try {
      const result = await checkRateLimit(
        req,
        endpoint
      )

      // Always set rate limit headers
      res.setHeader(
        'X-RateLimit-Limit',
        RATE_LIMITS[endpoint]?.requests ||
        RATE_LIMITS['default'].requests
      )
      res.setHeader(
        'X-RateLimit-Remaining',
        result.remaining || 0
      )

      if (!result.allowed) {
        res.setHeader(
          'Retry-After',
          result.retryAfter || 60
        )
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: result.retryAfter || 60,
          message: 'Please wait before making another request'
        })
      }

      // Attach IP to request for
      // use in downstream functions
      req.clientIP = result.ip
      next()

    } catch (error) {
      // Rate limiter failure never
      // blocks legitimate users
      console.error(
        'Rate limiter error:',
        error.message
      )
      req.clientIP = extractIP(req)
      next()
    }
  }
}

// Standalone check without middleware
const check = async (req, endpoint) => {
  try {
    return await checkRateLimit(req, endpoint)
  } catch (error) {
    // Fail open on error
    return {
      allowed: true,
      ip: extractIP(req),
      error: error.message
    }
  }
}

module.exports = {
  check,
  createMiddleware,
  extractIP,
  isBlocked,
  blockIP,
  RATE_LIMITS
}
