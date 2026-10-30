const { Redis } = require('@upstash/redis')
const { isWorkers } = require('./runtime')

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

// ─────────────────────────────────────────
// WORKERS MODE
// On Cloudflare Workers there is no Redis.
// Values live in memory for this instance and in
// the Cloudflare Cache API (shared per location,
// active on custom domains). Counters are kept in
// memory only, so rate limiting never needs a
// database and never costs a write.
// ─────────────────────────────────────────
const mem = new Map()
const counters = new Map()
const CACHE_BASE = 'https://cache.intelreap.internal/'
// Bump this when the meaning of cached data changes, so
// entries written by older code are never served again.
const WORKER_CACHE_VERSION = 'w3:'
const cacheReq = (key) =>
  new Request(CACHE_BASE + encodeURIComponent(WORKER_CACHE_VERSION + key))

const prune = (map) => {
  if (map.size < 5000) return
  const now = Date.now()
  for (const [k, v] of map) {
    if (v.exp <= now) map.delete(k)
  }
}

const wGet = async (key) => {
  const hit = mem.get(key)
  if (hit && hit.exp > Date.now()) return hit.v
  try {
    const r = await caches.default.match(cacheReq(key))
    if (!r) return null
    const text = await r.text()
    let v
    try { v = JSON.parse(text) } catch { v = text }
    mem.set(key, { v: v, exp: Date.now() + 30000 })
    return v
  } catch (e) {
    return null
  }
}

const wSet = async (key, value, ttlSeconds) => {
  mem.set(key, {
    v: value,
    exp: Date.now() + Math.min(ttlSeconds, 30) * 1000
  })
  prune(mem)
  try {
    await caches.default.put(
      cacheReq(key),
      new Response(JSON.stringify(value), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=' + ttlSeconds
        }
      })
    )
    return true
  } catch (e) {
    return false
  }
}

const wDel = async (key) => {
  mem.delete(key)
  try { await caches.default.delete(cacheReq(key)) } catch (e) {}
  return true
}

const wIncrement = async (key, ttlSeconds) => {
  const now = Date.now()
  let c = counters.get(key)
  if (!c || c.exp <= now) {
    c = { n: 0, exp: now + ttlSeconds * 1000 }
    counters.set(key, c)
    prune(counters)
  }
  c.n += 1
  return c.n
}

const wExists = async (key) => (await wGet(key)) !== null

const wStats = async () => ({
  available: true,
  backend: 'workers-cache'
})

module.exports = isWorkers
  ? {
      get: wGet,
      set: wSet,
      del: wDel,
      increment: wIncrement,
      exists: wExists,
      getStats: wStats,
      TTL,
      KEYS
    }
  : {
      get,
      set,
      del,
      increment,
      exists,
      getStats,
      TTL,
      KEYS
    }
