const fetch = require('node-fetch')
const cache = require('../lib/cache')
const validator = require('../lib/request-validator')

const GROQ_API_URL =
  'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

const GROQ_MODEL = 'llama3-8b-8192'
const GROQ_TIMEOUT_MS = 25000
const GEMINI_TIMEOUT_MS = 25000

const fetchWithTimeout = async (
  url,
  options = {},
  timeoutMs = 15000
) => {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  )
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(timeout)
    return response
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

// System instruction for all AI calls
const SYSTEM_INSTRUCTION = `
You are an expert intelligence analyst
for a network and device diagnostic system.
You write clear accurate helpful summaries
based strictly on the data provided.
You never invent data that was not given.
You write in plain English.
You are concise and precise.
You never use bullet points.
You never use headers.
You write in flowing prose only.
If a value is unknown or null
you do not mention it.
You only reference values that exist.
`

// Canvas specific prompt builders
const buildCanvasPrompt = (canvasId, data) => {
  const prompts = {
    canvas1: () => {
      const n = data.network || {}
      const s = data.scores || {}
      return `
        Network infrastructure data:
        ASN: ${n.asn || 'unknown'}
        ASN Owner: ${n.asnOwner || 'unknown'}
        ASN Type: ${n.asnType || 'unknown'}
        Network Tier: ${n.networkTier || 'unknown'}
        Registry: ${n.allocationRegistry || 'unknown'}
        Route Origin: ${n.routeOrigin || 'unknown'}
        Network Health: ${s.networkScore || 'unknown'}
        Write one sentence summarizing
        this user's network infrastructure.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas2: () => {
      const i = data.identity || {}
      return `
        Network identity data:
        IP: ${i.ip || 'unknown'}
        ISP: ${i.isp || 'unknown'}
        Country: ${i.country || 'unknown'}
        City: ${i.city || 'unknown'}
        Timezone: ${i.timezone || 'unknown'}
        Connection: ${i.connectionType || 'unknown'}
        Write one sentence summarizing
        this user's network identity.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas3: () => {
      const v = data.vpn || {}
      return `
        VPN and proxy detection data:
        VPN Detected: ${v.vpnDetected || 'unknown'}
        Proxy Detected: ${v.proxyDetected || 'unknown'}
        TOR Detected: ${v.torDetected || 'unknown'}
        Trust Score: ${v.trustScore || 'unknown'}
        Route: ${v.routeClassification || 'unknown'}
        Timezone Match: ${v.timezoneMatch || 'unknown'}
        Write one sentence summarizing
        this user's routing and privacy status.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas4: () => {
      const ln = data.liveNetwork || {}
      return `
        Live network performance data:
        Latency: ${ln.currentRtt || 'unknown'}ms
        Bandwidth: ${ln.bandwidth || 'unknown'}
        Connection Type: ${ln.effectiveType || 'unknown'}
        Quality: ${ln.qualityRating || 'unknown'}
        Stability: ${ln.stabilityIndex || 'unknown'}
        Write one sentence summarizing
        this user's live network performance.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas5: () => {
      const d = data.device || {}
      return `
        Device intelligence data:
        OS: ${d.os || 'unknown'}
        Browser: ${d.browser || 'unknown'}
        Device Type: ${d.deviceType || 'unknown'}
        CPU Cores: ${d.cpuCores || 'unknown'}
        RAM: ${d.ram || 'unknown'}GB
        Tier: ${d.capabilityTier || 'unknown'}
        Write one sentence summarizing
        this user's device specification.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas6: () => {
      const g = data.graphics || {}
      return `
        Graphics engine data:
        GPU Vendor: ${g.gpuVendor || 'unknown'}
        GPU Renderer: ${g.gpuRenderer || 'unknown'}
        WebGL Version: ${g.webglVersion || 'unknown'}
        Hardware Acceleration: ${g.hardwareAcceleration || 'unknown'}
        Graphics Tier: ${g.graphicsTier || 'unknown'}
        Rendering Score: ${g.renderingScore || 'unknown'}
        Write one sentence summarizing
        this user's graphics capability.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas7: () => {
      const sec = data.security || {}
      return `
        Security and privacy data:
        HTTPS: ${sec.httpsStatus || 'unknown'}
        Secure Context: ${sec.secureContext || 'unknown'}
        WebRTC Exposure: ${sec.webrtcExposure || 'unknown'}
        Security Score: ${sec.securityScore || 'unknown'}
        Risk Level: ${sec.riskLevel || 'unknown'}
        Write one sentence summarizing
        this user's security posture.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas8: () => {
      const cap = data.capabilities || {}
      return `
        Browser capability data:
        WebGPU: ${cap.webgpu ? 'supported' : 'not supported'}
        WebAssembly: ${cap.wasm ? 'supported' : 'not supported'}
        Service Workers: ${cap.serviceWorker ? 'supported' : 'not supported'}
        WebRTC: ${cap.webrtc ? 'supported' : 'not supported'}
        Capability Score: ${cap.capabilityScore || 'unknown'}
        Write one sentence summarizing
        this user's browser capabilities.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas9: () => {
      const p = data.performance || {}
      const s = data.scores || {}
      return `
        Performance intelligence data:
        Page Load: ${p.pageLoadTime || 'unknown'}ms
        DOM Ready: ${p.domContentLoaded || 'unknown'}ms
        TTFB: ${p.ttfb || 'unknown'}ms
        Performance Score: ${s.performanceScore || 'unknown'}
        Percentile: ${p.percentileRating || 'unknown'}
        Write one sentence summarizing
        this user's page performance.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas10: () => {
      const sp = data.speed || {}
      const s = data.scores || {}
      return `
        Browser speed and rendering data:
        LCP: ${sp.lcp || 'unknown'}ms rated ${sp.lcpRating || 'unknown'}
        FCP: ${sp.fcp || 'unknown'}ms rated ${sp.fcpRating || 'unknown'}
        CLS: ${sp.cls || 'unknown'} rated ${sp.clsRating || 'unknown'}
        Benchmark Score: ${sp.benchmarkScore || 'unknown'}
        Speed Score: ${s.speedScore || 'unknown'}
        Write one sentence summarizing
        this user's browser rendering speed.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas11: () => {
      const s = data.scores || {}
      return `
        Global intelligence scores:
        Global Score: ${s.globalScore || 'unknown'}/100
        Network Score: ${s.networkScore || 'unknown'}
        Security Score: ${s.securityScore || 'unknown'}
        Device Score: ${s.deviceScore || 'unknown'}
        Performance Score: ${s.performanceScore || 'unknown'}
        Health: ${s.healthClassification || 'unknown'}
        Write one sentence summarizing
        this user's overall environment score.
        Use the actual values provided.
        Maximum 25 words.
      `
    },
    canvas12: () => {
      const meta = data.meta || {}
      const events = data.events || []
      return `
        Live intelligence feed data:
        Events logged: ${events.length || 0}
        Online status: ${meta.isOnline ? 'online' : 'offline'}
        Backend healthy: ${meta.backendHealthy ? 'yes' : 'no'}
        Last change: ${meta.lastNetworkChange || 'none'}
        Write one sentence summarizing
        the current live system status.
        Use the actual values provided.
        Maximum 25 words.
      `
    }
  }

  const builder = prompts[canvasId]
  if (!builder) return null

  try {
    return builder()
  } catch {
    return null
  }
}

// Full system prompt builder
const buildFullSystemPrompt = (data) => {
  const n = data.network || {}
  const i = data.identity || {}
  const v = data.vpn || {}
  const ln = data.liveNetwork || {}
  const d = data.device || {}
  const g = data.graphics || {}
  const sec = data.security || {}
  const cap = data.capabilities || {}
  const p = data.performance || {}
  const sp = data.speed || {}
  const s = data.scores || {}

  return `
    You are an expert network and device
    intelligence analyst. Write a single
    coherent diagnostic paragraph of
    4 to 6 sentences summarizing this
    user's complete digital environment.
    Be specific. Use the actual data values.
    Write in plain English any user understands.
    End with one actionable recommendation.
    Do not use bullet points or headers.
    Only reference values that are provided.
    Do not mention unknown or null values.

    NETWORK INFRASTRUCTURE
    ASN: ${n.asn || ''}
    ASN Owner: ${n.asnOwner || ''}
    ASN Type: ${n.asnType || ''}
    Network Tier: ${n.networkTier || ''}
    Registry: ${n.allocationRegistry || ''}

    NETWORK IDENTITY
    IP: ${i.ip || ''}
    ISP: ${i.isp || ''}
    Location: ${i.city || ''} ${i.country || ''}
    Connection: ${i.connectionType || ''}

    PRIVACY AND ROUTING
    VPN: ${v.vpnDetected || ''}
    Proxy: ${v.proxyDetected || ''}
    TOR: ${v.torDetected || ''}
    Trust Score: ${v.trustScore || ''}
    Route: ${v.routeClassification || ''}

    LIVE NETWORK
    Latency: ${ln.currentRtt || ''}ms
    Bandwidth: ${ln.bandwidth || ''}
    Quality: ${ln.qualityRating || ''}

    DEVICE
    OS: ${d.os || ''}
    Browser: ${d.browser || ''}
    Type: ${d.deviceType || ''}
    CPU: ${d.cpuCores || ''} cores
    RAM: ${d.ram || ''}GB
    Tier: ${d.capabilityTier || ''}

    GRAPHICS
    GPU: ${g.gpuVendor || ''}
    WebGL: ${g.webglVersion || ''}
    Graphics Tier: ${g.graphicsTier || ''}

    SECURITY
    HTTPS: ${sec.httpsStatus || ''}
    WebRTC Exposure: ${sec.webrtcExposure || ''}
    Security Score: ${sec.securityScore || ''}
    Risk Level: ${sec.riskLevel || ''}

    CAPABILITIES
    WebGPU: ${cap.webgpu ? 'supported' : 'not supported'}
    WebAssembly: ${cap.wasm ? 'supported' : 'not supported'}
    Capability Score: ${cap.capabilityScore || ''}

    PERFORMANCE
    Page Load: ${p.pageLoadTime || ''}ms
    TTFB: ${p.ttfb || ''}ms
    Performance Score: ${s.performanceScore || ''}

    SPEED
    LCP: ${sp.lcp || ''}ms
    FCP: ${sp.fcp || ''}ms
    Benchmark Score: ${sp.benchmarkScore || ''}

    GLOBAL SCORES
    Global Score: ${s.globalScore || ''}/100
    Health: ${s.healthClassification || ''}
    Strongest Area: ${s.strongestArea || ''}
    Weakest Area: ${s.weakestArea || ''}
  `
}

// Layer 1 script summary engine
// Always runs, always free, never fails
const generateScriptSummary = (
  type,
  canvasId,
  data
) => {
  if (type === 'full') {
    const s = data.scores || {}
    const i = data.identity || {}
    const d = data.device || {}
    const sec = data.security || {}

    const score = s.globalScore || 0
    const health =
      s.healthClassification || 'Unknown'
    const city = i.city || 'Unknown location'
    const country = i.country || ''
    const isp = i.isp || 'Unknown ISP'
    const device = d.deviceType || 'device'
    const os = d.os || 'Unknown OS'
    const browser = d.browser || 'Unknown browser'
    const securityRisk =
      sec.riskLevel || 'Unknown'
    const weakest = s.weakestArea || 'unknown'

    return (
      `You are connecting from ` +
      `${city}${country ? ', ' + country : ''}` +
      ` via ${isp}. ` +
      `Your ${device} running ${os}` +
      ` with ${browser} has been analysed. ` +
      `Environment scores ${score}/100` +
      ` with ${health} classification. ` +
      `Security risk is ${securityRisk}. ` +
      `Weakest area is ${weakest}.`
    )
  }

  const summaryMap = {
    canvas1: () => {
      const n = data.network || {}
      return (
        `You are on a ` +
        `${n.networkTier || 'unknown tier'} ` +
        `${n.asnType || 'network'} ` +
        `operated by ${n.asnOwner || 'unknown'}.`
      )
    },
    canvas2: () => {
      const i = data.identity || {}
      return (
        `Your internet identity resolves to ` +
        `${i.city || 'unknown'}` +
        `${i.country ? ', ' + i.country : ''}` +
        ` via ${i.isp || 'unknown ISP'}` +
        ` on a ${i.connectionType || 'unknown'} connection.`
      )
    },
    canvas3: () => {
      const v = data.vpn || {}
      const vpn = v.vpnDetected || 'unknown'
      const trust = v.trustScore || 0
      const route =
        v.routeClassification || 'unknown'
      return vpn === 'yes'
        ? `VPN detected on your connection with a trust score of ${trust}/100 and ${route} route classification.`
        : `No VPN or proxy detected. Trust score ${trust}/100 with a ${route} route classification.`
    },
    canvas4: () => {
      const ln = data.liveNetwork || {}
      return (
        `Your live connection shows ` +
        `${ln.currentRtt || 0}ms latency` +
        ` on a ${ln.effectiveType || 'unknown'} link` +
        ` with ${ln.qualityRating || 'unknown'} quality.`
      )
    },
    canvas5: () => {
      const d = data.device || {}
      return (
        `You are using ${d.browser || 'unknown'} ` +
        `on ${d.os || 'unknown'} ` +
        `with ${d.cpuCores || 'unknown'} CPU cores` +
        ` — a ${d.capabilityTier || 'unknown'} tier device.`
      )
    },
    canvas6: () => {
      const g = data.graphics || {}
      return (
        `Your ${g.gpuVendor || 'unknown'} GPU ` +
        `supports ${g.webglVersion || 'unknown'} ` +
        `placing graphics capability in ` +
        `the ${g.graphicsTier || 'unknown'} tier.`
      )
    },
    canvas7: () => {
      const sec = data.security || {}
      return (
        `Connection is ${sec.httpsStatus || 'unknown'} ` +
        `with security score ${sec.securityScore || 0}/100. ` +
        `WebRTC exposure is ${sec.webrtcExposure || 'unknown'}.`
      )
    },
    canvas8: () => {
      const cap = data.capabilities || {}
      const score = cap.capabilityScore || 0
      const webgpu = cap.webgpu
      const wasm = cap.wasm
      return (
        `Browser scores ${score}/100 on capability detection. ` +
        `WebGPU is ${webgpu ? 'supported' : 'not supported'} ` +
        `and WebAssembly is ` +
        `${wasm ? 'supported' : 'not supported'}.`
      )
    },
    canvas9: () => {
      const p = data.performance || {}
      return (
        `Page loaded in ${p.pageLoadTime || 0}ms ` +
        `with ${p.ttfb || 0}ms TTFB ` +
        `placing you in the ` +
        `${p.percentileRating || 'unknown'} performance percentile.`
      )
    },
    canvas10: () => {
      const sp = data.speed || {}
      const s = data.scores || {}
      return (
        `Largest Contentful Paint is ` +
        `${sp.lcp || 0}ms rated ${sp.lcpRating || 'unknown'} ` +
        `with overall speed score ` +
        `${s.speedScore || 0}/100.`
      )
    },
    canvas11: () => {
      const s = data.scores || {}
      return (
        `Global environment score is ` +
        `${s.globalScore || 0}/100 ` +
        `with ${s.healthClassification || 'unknown'} classification. ` +
        `Strongest area is ${s.strongestArea || 'unknown'}.`
      )
    },
    canvas12: () => {
      const meta = data.meta || {}
      const events = data.events || []
      return (
        `System is ` +
        `${meta.isOnline ? 'online' : 'offline'} ` +
        `with ${events.length || 0} ` +
        `intelligence events logged since page load.`
      )
    }
  }

  const generator = summaryMap[canvasId]
  if (!generator) {
    return 'Intelligence analysis complete.'
  }

  try {
    return generator()
  } catch {
    return 'Intelligence analysis complete.'
  }
}

// Validate request body
const validateBody = (body) => {
  if (!body) return 'Request body required'
  if (!body.type) return 'Summary type required'
  if (!['canvas', 'full'].includes(body.type)) {
    return 'Type must be canvas or full'
  }
  if (body.type === 'canvas' && !body.canvas) {
    return 'Canvas ID required for canvas type'
  }
  if (!body.data) {
    return 'Intelligence data required'
  }
  return null
}

// Groq API call
const callGroq = async (prompt, apiKey) => {
  if (!apiKey) {
    throw new Error('Groq key not configured')
  }

  const response = await fetchWithTimeout(
    GROQ_API_URL,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: SYSTEM_INSTRUCTION
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.4,
        top_p: 0.9,
        stream: false
      })
    },
    GROQ_TIMEOUT_MS
  )

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `Groq ${response.status}: ${errorBody}`
    )
  }

  const data = await response.json()

  if (!data.choices?.[0]) {
    throw new Error('Groq returned no choices')
  }

  const content =
    data.choices[0].message?.content

  if (!content?.trim()) {
    throw new Error('Groq returned empty content')
  }

  return {
    summary: content.trim(),
    model: data.model,
    tokensUsed: data.usage?.total_tokens || null,
    source: 'groq'
  }
}

// Gemini API call
const callGemini = async (prompt, apiKey) => {
  if (!apiKey) {
    throw new Error('Gemini key not configured')
  }

  const url = `${GEMINI_API_URL}?key=${apiKey}`

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: SYSTEM_INSTRUCTION +
                  '\n\n' + prompt
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.4,
          topP: 0.9,
          topK: 40
        },
        safetySettings: [
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'BLOCK_NONE'
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'BLOCK_NONE'
          }
        ]
      })
    },
    GEMINI_TIMEOUT_MS
  )

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `Gemini ${response.status}: ${errorBody}`
    )
  }

  const data = await response.json()

  if (!data.candidates?.[0]) {
    throw new Error(
      'Gemini returned no candidates'
    )
  }

  const content =
    data.candidates[0].content?.parts?.[0]?.text

  if (!content?.trim()) {
    throw new Error(
      'Gemini returned empty content'
    )
  }

  return {
    summary: content.trim(),
    model: 'gemini-1.5-flash',
    tokensUsed:
      data.usageMetadata?.totalTokenCount ||
      null,
    source: 'gemini'
  }
}

module.exports = async (req, res) => {

  // Run full validation pipeline
  const validation = await validator.validate(
    req,
    res,
    'ai-summary'
  )

  if (!validation.valid) return

  const startTime = Date.now()

  // Validate request body
  const bodyError = validateBody(req.body)
  if (bodyError) {
    return res.status(400).json({
      success: false,
      error: bodyError,
      timestamp: new Date().toISOString()
    })
  }

  const {
    type,
    canvas: canvasId,
    data
  } = req.body

  const clientIP = req.clientIP || 'unknown'

  // Build cache key
  const cacheKey = type === 'full'
    ? cache.KEYS.aiSummaryFull(clientIP)
    : cache.KEYS.aiSummaryCanvas(
        clientIP,
        canvasId
      )

  // Check cache first
  const cached = await cache.get(cacheKey)
  if (cached) {
    return res.status(200).json({
      success: true,
      summary: cached.summary,
      source: cached.source,
      fromCache: true,
      generatedAt: cached.generatedAt,
      responseTime:
        (Date.now() - startTime) + 'ms'
    })
  }

  // Always generate script summary first
  const scriptSummary = generateScriptSummary(
    type,
    canvasId,
    data
  )

  // Build prompt
  const prompt = type === 'canvas'
    ? buildCanvasPrompt(canvasId, data)
    : buildFullSystemPrompt(data)

  // If no prompt built return script summary
  if (!prompt) {
    return res.status(200).json({
      success: true,
      summary: scriptSummary,
      source: 'script',
      generatedAt: new Date().toISOString(),
      responseTime:
        (Date.now() - startTime) + 'ms'
    })
  }

  const groqKey = process.env.GROQ_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  const errors = []

  // Layer 2 — Groq
  try {
    const result = await callGroq(prompt, groqKey)

    const ttl = type === 'full'
      ? cache.TTL.AI_SUMMARY_FULL
      : cache.TTL.AI_SUMMARY_CANVAS

    const response = {
      summary: result.summary,
      source: result.source,
      model: result.model,
      tokensUsed: result.tokensUsed,
      scriptFallback: scriptSummary,
      generatedAt: new Date().toISOString()
    }

    await cache.set(cacheKey, response, ttl)

    return res.status(200).json({
      success: true,
      ...response,
      fromCache: false,
      responseTime:
        (Date.now() - startTime) + 'ms'
    })

  } catch (groqError) {
    errors.push({
      layer: 'groq',
      error: groqError.message
    })
  }

  // Layer 3 — Gemini
  try {
    const result = await callGemini(
      prompt,
      geminiKey
    )

    const ttl = type === 'full'
      ? cache.TTL.AI_SUMMARY_FULL
      : cache.TTL.AI_SUMMARY_CANVAS

    const response = {
      summary: result.summary,
      source: result.source,
      model: result.model,
      tokensUsed: result.tokensUsed,
      scriptFallback: scriptSummary,
      generatedAt: new Date().toISOString()
    }

    await cache.set(cacheKey, response, ttl)

    return res.status(200).json({
      success: true,
      ...response,
      fromCache: false,
      responseTime:
        (Date.now() - startTime) + 'ms'
    })

  } catch (geminiError) {
    errors.push({
      layer: 'gemini',
      error: geminiError.message
    })
  }

  // Layer 1 — Script fallback
  // Always succeeds
  return res.status(200).json({
    success: true,
    summary: scriptSummary,
    source: 'script',
    scriptFallback: scriptSummary,
    apiErrors: errors,
    generatedAt: new Date().toISOString(),
    responseTime:
      (Date.now() - startTime) + 'ms'
  })
}
