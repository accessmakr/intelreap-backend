const fetch = require('node-fetch')

const SYSTEM_VERSION = '1.0.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
}

module.exports = async (req, res) => {

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ status: 'ok' })
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      error: 'Method not allowed',
      allowedMethods: ['GET']
    })
  }

  const startTime = Date.now()

  try {

    // Run all subsystem checks in parallel
    const [
      fetchCheck,
      memoryCheck,
      timestampCheck
    ] = await Promise.allSettled([

      // Check 1 — Verify fetch capability
      (async () => {
        const controller = new AbortController()
        const timeout = setTimeout(
          () => controller.abort(), 3000
        )
        try {
          const response = await fetch(
            'https://api.ipify.org?format=json',
            { signal: controller.signal }
          )
          clearTimeout(timeout)
          return {
            status: 'ok',
            reachable: response.ok,
            latency: Date.now() - startTime
          }
        } catch (err) {
          clearTimeout(timeout)
          return {
            status: 'degraded',
            reachable: false,
            error: err.message
          }
        }
      })(),

      // Check 2 — Memory availability
      (async () => {
        const used = process.memoryUsage()
        return {
          status: 'ok',
          heapUsed: Math.round(
            used.heapUsed / 1024 / 1024
          ) + 'MB',
          heapTotal: Math.round(
            used.heapTotal / 1024 / 1024
          ) + 'MB',
          rss: Math.round(
            used.rss / 1024 / 1024
          ) + 'MB'
        }
      })(),

      // Check 3 — Timestamp integrity
      (async () => {
        const now = new Date()
        return {
          status: 'ok',
          utc: now.toISOString(),
          unix: Math.floor(now.getTime() / 1000),
          timezone: 'UTC'
        }
      })()

    ])

    const responseTime = Date.now() - startTime

    // Determine overall system health
    const fetchStatus = fetchCheck.status === 'fulfilled'
      ? fetchCheck.value.status
      : 'degraded'

    const overallStatus = fetchStatus === 'ok'
      ? 'operational'
      : 'degraded'

    // Set response headers
    Object.entries(CORS_HEADERS).forEach(
      ([key, value]) => res.setHeader(key, value)
    )

    return res.status(200).json({
      status: overallStatus,
      version: SYSTEM_VERSION,
      timestamp: new Date().toISOString(),
      responseTime: responseTime + 'ms',
      environment: process.env.VERCEL_ENV || 'development',
      region: process.env.VERCEL_REGION || 'unknown',
      subsystems: {
        network: {
          status: fetchStatus,
          details: fetchCheck.status === 'fulfilled'
            ? fetchCheck.value
            : { error: fetchCheck.reason?.message }
        },
        memory: {
          status: memoryCheck.status === 'fulfilled'
            ? 'ok'
            : 'degraded',
          details: memoryCheck.status === 'fulfilled'
            ? memoryCheck.value
            : { error: memoryCheck.reason?.message }
        },
        clock: {
          status: timestampCheck.status === 'fulfilled'
            ? 'ok'
            : 'degraded',
          details: timestampCheck.status === 'fulfilled'
            ? timestampCheck.value
            : { error: timestampCheck.reason?.message }
        }
      },
      endpoints: {
        health: 'operational',
        ipIdentity: 'available',
        ipDeep: 'available',
        proxyIntelligence: 'available',
        aiSummary: 'available'
      }
    })

  } catch (error) {

    // Set response headers even on error
    Object.entries(CORS_HEADERS).forEach(
      ([key, value]) => res.setHeader(key, value)
    )

    return res.status(500).json({
      status: 'error',
      version: SYSTEM_VERSION,
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: error.message,
      responseTime: (Date.now() - startTime) + 'ms'
    })
  }
}
