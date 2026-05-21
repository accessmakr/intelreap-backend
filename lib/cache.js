const { Redis } = require('@upstash/redis')

// Initialize Redis client using
// Vercel KV environment variables
// automatically set by Upstash connection
let redisClient = null

const getRedisClient = () => {
  if (redisClient) return redisClient

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    return null
  }

  try {
    redisClient = new Redis({
      url: url,
      token: token
    })
    return redisClient
  } catch (error) {
    console.error(
      'Redis client initialization failed:',
      error.message
    )
    return null
  }
}

// TTL constants in seconds
const TTL = {
  IP_IDENTITY: 86400,      // 24 hours
  IP_DEEP: 86400,          // 24 hours
  PROXY_INTELLIGENCE: 21600, // 6 hours
  AI_SUMMARY_CANVAS: 600,  // 10 minutes
  AI_SUMMARY_FULL: 300,    // 5 minutes
  RATE_LIMIT: 60,          // 1 minute window
  BOT_BLOCK: 86400,        // 24 hour block
  HEALTH: 30               // 30 seconds
}

// Cache key builders
const KEYS = {
  ipIdentity: (ip) =>
    `ip:identity:${ip}`,
  ipDeep: (ip) =>
    `ip:deep:${ip}`,
  proxyIntelligence: (ip) =>
    `ip:proxy:${ip}`,
  aiSummaryCanvas: (ip, canvasId) =>
    `ai:canvas:${canvasId}:${ip}`,
  aiSummaryFull: (ip) =>
    `ai:full:${ip}`,
  rateLimit: (ip, endpoint) =>
    `rate:${endpoint}:${ip}`,
  botBlock: (ip) =>
    `bot:blocked:${ip}`,
  honeypot: (ip) =>
    `honeypot:hit:${ip}`
}

// Get cached value
const get = async (key) => {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const value = await redis.get(key)
    if (!value) return null

    // Parse if string
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }
    return value

  } catch (error) {
    // Cache failure never breaks the app
    console.error(
      'Cache get failed:',
      error.message
    )
    return null
  }
}

// Set cached value with TTL
const set = async (key, value, ttlSeconds) => {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const serialized = typeof value === 'string'
      ? value
      : JSON.stringify(value)

    await redis.setex(key, ttlSeconds, serialized)
    return true

  } catch (error) {
    console.error(
      'Cache set failed:',
      error.message
    )
    return false
  }
}

// Delete cached value
const del = async (key) => {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    await redis.del(key)
    return true
  } catch (error) {
    console.error(
      'Cache delete failed:',
      error.message
    )
    return false
  }
}

// Increment counter with TTL
// Used for rate limiting
const increment = async (key, ttlSeconds) => {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const pipeline = redis.pipeline()
    pipeline.incr(key)
    pipeline.expire(key, ttlSeconds)
    const results = await pipeline.exec()
    return results[0]
  } catch (error) {
    console.error(
      'Cache increment failed:',
      error.message
    )
    return null
  }
}

// Check if key exists
const exists = async (key) => {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const result = await redis.exists(key)
    return result === 1
  } catch (error) {
    console.error(
      'Cache exists check failed:',
      error.message
    )
    return false
  }
}

// Get cache statistics
const getStats = async () => {
  const redis = getRedisClient()
  if (!redis) {
    return {
      available: false,
      reason: 'Redis client not initialized'
    }
  }

  try {
    const info = await redis.info()
    return {
      available: true,
      info: info
    }
  } catch (error) {
    return {
      available: false,
      reason: error.message
    }
  }
}

module.exports = {
  get,
  set,
  del,
  increment,
  exists,
  getStats,
  TTL,
  KEYS
}
