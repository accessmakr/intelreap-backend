// ─────────────────────────────────────────
// CLOUDFLARE WORKER ENTRY
// Runs the existing /api handlers on Cloudflare.
// A small adapter turns each Worker request into
// the req/res objects the handlers already expect.
// ─────────────────────────────────────────
import health from '../api/health.js'
import ipIdentity from '../api/ip-identity.js'
import ipDeep from '../api/ip-deep.js'
import proxyIntelligence from '../api/proxy-intelligence.js'
import aiSummary from '../api/ai-summary.js'
import headersEcho from '../api/headers-echo.js'
import ipv6Check from '../api/ipv6-check.js'

const ROUTES = {
  '/api/health': health,
  '/api/ip-identity': ipIdentity,
  '/api/ip-deep': ipDeep,
  '/api/proxy-intelligence': proxyIntelligence,
  '/api/ai-summary': aiSummary,
  '/api/headers-echo': headersEcho,
  '/api/ipv6-check': ipv6Check
}

const DEFAULT_ORIGINS = [
  'https://intelreap.com',
  'https://www.intelreap.com'
]

const isLocalOrigin = (o) =>
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)

const allowedOrigin = (origin, env) => {
  if (!origin) return null
  const extra = (env && env.ALLOWED_ORIGINS
    ? String(env.ALLOWED_ORIGINS).split(',')
    : []
  ).map(s => s.trim()).filter(Boolean)
  if (DEFAULT_ORIGINS.includes(origin)) return origin
  if (extra.includes(origin)) return origin
  if (isLocalOrigin(origin)) return origin
  return null
}

const corsHeaders = (origin) => {
  const h = new Headers()
  if (origin) {
    h.set('Access-Control-Allow-Origin', origin)
    h.set('Vary', 'Origin')
    h.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
    h.set('Access-Control-Allow-Headers', 'Content-Type')
    h.set('Access-Control-Max-Age', '86400')
  }
  return h
}

class Res {
  constructor () {
    this.statusCode = 200
    this.headers = new Headers()
    this.body = null
    this.finished = false
  }
  setHeader (k, v) { this.headers.set(k, String(v)); return this }
  getHeader (k) { return this.headers.get(k) }
  status (c) { this.statusCode = c; return this }
  writeHead (c, h) {
    this.statusCode = c
    if (h) Object.entries(h).forEach(([k, v]) => this.setHeader(k, v))
    return this
  }
  json (o) {
    this.headers.set('Content-Type', 'application/json; charset=utf-8')
    this.body = JSON.stringify(o)
    this.finished = true
    return this
  }
  send (b) {
    if (typeof b === 'object' && b !== null) return this.json(b)
    this.body = b == null ? '' : String(b)
    this.finished = true
    return this
  }
  end (b) { return this.send(b) }
}

const buildReq = async (request, url, env) => {
  const headers = {}
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
  // cf-connecting-ip is set by Cloudflare and cannot be
  // forged by the visitor. Use it for every IP lookup.
  const ip = headers['cf-connecting-ip'] || 'unknown'
  headers['x-forwarded-for'] = ip
  headers['x-real-ip'] = ip

  let body
  if (request.method === 'POST') {
    const text = await request.text()
    headers['content-length'] = String(text.length)
    try { body = text ? JSON.parse(text) : {} } catch { body = {} }
  }
  return {
    // HEAD is answered like GET, without a body
    method: request.method === 'HEAD' ? 'GET' : request.method,
    headers,
    url: url.pathname + url.search,
    query: Object.fromEntries(url.searchParams),
    body,
    cf: request.cf,
    connection: { remoteAddress: ip },
    socket: { remoteAddress: ip }
  }
}

const applyEnv = (env) => {
  if (typeof process === 'undefined' || !process.env) return
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === 'string') process.env[k] = v
  }
}

export default {
  async fetch (request, env) {
    applyEnv(env)
    const url = new URL(request.url)
    const origin = allowedOrigin(request.headers.get('Origin'), env)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') {
      if (request.headers.get('Origin') && !origin) {
        return new Response(null, { status: 403 })
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (path === '/') {
      return new Response(
        JSON.stringify({ service: 'intelreap-backend', status: 'ok' }),
        { headers: { 'Content-Type': 'application/json', ...Object.fromEntries(corsHeaders(origin)) } }
      )
    }

    const handler = ROUTES[path]
    if (!handler) {
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...Object.fromEntries(corsHeaders(origin)) } }
      )
    }

    const req = await buildReq(request, url, env)
    const res = new Res()
    try {
      await handler(req, res)
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal error',
        message: String(error && error.message || error)
      })
    }

    // Replace whatever CORS headers the handler set
    // with the allowlist.
    for (const k of [...res.headers.keys()]) {
      if (k.toLowerCase().startsWith('access-control-')) res.headers.delete(k)
    }
    corsHeaders(origin).forEach((v, k) => res.headers.set(k, v))
    res.headers.set('X-Content-Type-Options', 'nosniff')
    res.headers.set('Cache-Control', 'no-store')

    const nullBody =
      res.statusCode === 204 ||
      res.statusCode === 304 ||
      request.method === 'HEAD'
    return new Response(nullBody ? null : (res.body == null ? '' : res.body), {
      status: res.statusCode,
      headers: res.headers
    })
  }
}
