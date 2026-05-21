const fetch = require('node-fetch')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

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

// Canvas specific prompt builders
const buildCanvasPrompt = (canvasId, data) => {
  const canvasContextMap = {
    canvas1: `
      Network infrastructure data:
      ASN: ${data.network?.asn || 'unknown'}
      ASN Owner: ${data.network?.asnOwner || 'unknown'}
      ASN Type: ${data.network?.asnType || 'unknown'}
      Network Tier: ${data.network?.networkTier || 'unknown'}
      Allocation Registry: ${data.network?.allocationRegistry || 'unknown'}
      Route Origin: ${data.network?.routeOrigin || 'unknown'}
      Network Health Score: ${data.scores?.networkScore || 'unknown'}
      Write one clear sentence summarizing
      this user's network infrastructure.
    `,
    canvas2: `
      Network identity data:
      IP: ${data.identity?.ip || 'unknown'}
      ISP: ${data.identity?.isp || 'unknown'}
      Country: ${data.identity?.country || 'unknown'}
      City: ${data.identity?.city || 'unknown'}
      Timezone: ${data.identity?.timezone || 'unknown'}
      Connection Type: ${data.identity?.connectionType || 'unknown'}
      Write one clear sentence summarizing
      this user's network identity.
    `,
    canvas3: `
      VPN and proxy detection data:
      VPN Detected: ${data.vpn?.vpnDetected || 'unknown'}
      Proxy Detected: ${data.vpn?.proxyDetected || 'unknown'}
      TOR Detected: ${data.vpn?.torDetected || 'unknown'}
      Trust Score: ${data.vpn?.trustScore || 'unknown'}
      Route Classification: ${data.vpn?.routeClassification || 'unknown'}
      Timezone Match: ${data.vpn?.timezoneMatch || 'unknown'}
      Write one clear sentence summarizing
      this user's routing and privacy status.
    `,
    canvas4: `
      Live network performance data:
      Current Latency: ${data.liveNetwork?.currentRtt || 'unknown'}ms
      Average Latency: ${data.liveNetwork?.averageRtt || 'unknown'}ms
      Bandwidth Estimate: ${data.liveNetwork?.bandwidth || 'unknown'}
      Connection Type: ${data.liveNetwork?.effectiveType || 'unknown'}
      Connection Quality: ${data.liveNetwork?.qualityRating || 'unknown'}
      Stability Index: ${data.liveNetwork?.stabilityIndex || 'unknown'}
      Write one clear sentence summarizing
      this user's live network performance.
    `,
    canvas5: `
      Device intelligence data:
      OS: ${data.device?.os || 'unknown'}
      Browser: ${data.device?.browser || 'unknown'}
      Device Type: ${data.device?.deviceType || 'unknown'}
      CPU Cores: ${data.device?.cpuCores || 'unknown'}
      RAM: ${data.device?.ram || 'unknown'}GB
      Device Tier: ${data.device?.capabilityTier || 'unknown'}
      Write one clear sentence summarizing
      this user's device specification.
    `,
    canvas6: `
      Graphics engine data:
      GPU Vendor: ${data.graphics?.gpuVendor || 'unknown'}
      GPU Renderer: ${data.graphics?.gpuRenderer || 'unknown'}
      WebGL Version: ${data.graphics?.webglVersion || 'unknown'}
      Hardware Acceleration: ${data.graphics?.hardwareAcceleration || 'unknown'}
      Graphics Tier: ${data.graphics?.graphicsTier || 'unknown'}
      Rendering Score: ${data.graphics?.renderingScore || 'unknown'}
      Write one clear sentence summarizing
      this user's graphics capability.
    `,
    canvas7: `
      Security and privacy data:
      HTTPS Status: ${data.security?.httpsStatus || 'unknown'}
      Secure Context: ${data.security?.secureContext || 'unknown'}
      WebRTC Exposure: ${data.security?.webrtcExposure || 'unknown'}
      Security Score: ${data.security?.securityScore || 'unknown'}
      Risk Level: ${data.security?.riskLevel || 'unknown'}
      Write one clear sentence summarizing
      this user's security posture.
    `,
    canvas8: `
      Browser capability data:
      WebGPU: ${data.capabilities?.webgpu || 'unknown'}
      WebAssembly: ${data.capabilities?.wasm || 'unknown'}
      Service Workers: ${data.capabilities?.serviceWorker || 'unknown'}
      WebRTC: ${data.capabilities?.webrtc || 'unknown'}
      Capability Score: ${data.capabilities?.capabilityScore || 'unknown'}
      Write one clear sentence summarizing
      this user's browser capabilities.
    `,
    canvas9: `
      Performance intelligence data:
      Page Load Time: ${data.performance?.pageLoadTime || 'unknown'}ms
      DOM Ready: ${data.performance?.domContentLoaded || 'unknown'}ms
      TTFB: ${data.performance?.ttfb || 'unknown'}ms
      Performance Score: ${data.scores?.performanceScore || 'unknown'}
      Performance Percentile: ${data.performance?.percentileRating || 'unknown'}
      Write one clear sentence summarizing
      this user's page performance.
    `,
    canvas10: `
      Browser speed and rendering data:
      LCP: ${data.speed?.lcp || 'unknown'}ms (${data.speed?.lcpRating || 'unknown'})
      FCP: ${data.speed?.fcp || 'unknown'}ms (${data.speed?.fcpRating || 'unknown'})
      CLS: ${data.speed?.cls || 'unknown'} (${data.speed?.clsRating || 'unknown'})
      Benchmark Score: ${data.speed?.benchmarkScore || 'unknown'}
      Speed Score: ${data.scores?.speedScore || 'unknown'}
      Write one clear sentence summarizing
      this user's browser rendering speed.
    `,
    canvas11: `
      Global intelligence scores:
      Global Score: ${data.scores?.globalScore || 'unknown'}
      Network Score: ${data.scores?.networkScore || 'unknown'}
      Security Score: ${data.scores?.securityScore || 'unknown'}
      Device Score: ${data.scores?.deviceScore || 'unknown'}
      Performance Score: ${data.scores?.performanceScore || 'unknown'}
      Health Classification: ${data.scores?.healthClassification || 'unknown'}
      Write one clear sentence summarizing
      this user's overall environment score.
    `,
    canvas12: `
      Live intelligence feed data:
      Events logged: ${data.events?.length || 0}
      Online status: ${data.meta?.isOnline ? 'online' : 'offline'}
      Backend healthy: ${data.meta?.backendHealthy ? 'yes' : 'no'}
      Last network change: ${data.meta?.lastNetworkChange || 'none detected'}
      Write one clear sentence summarizing
      the current live system status.
    `
  }

  return canvasContextMap[canvasId] || null
}

// Full system prompt builder
const buildFullSystemPrompt = (data) => {
  return `
    You are an expert network and device
    intelligence analyst. Write a single
    coherent diagnostic paragraph of
    4 to 6 sentences summarizing this
    user's complete digital environment.
    Be specific, use the actual data values,
    and write in plain English that any
    user can understand. Do not use
    technical jargon without explanation.
    End with one actionable recommendation.

    Complete environment data:

    NETWORK INFRASTRUCTURE
    ASN: ${data.network?.asn || 'unknown'}
    ASN Owner: ${data.network?.asnOwner || 'unknown'}
    ASN Type: ${data.network?.asnType || 'unknown'}
    Network Tier: ${data.network?.networkTier || 'unknown'}
    Registry: ${data.network?.allocationRegistry || 'unknown'}

    NETWORK IDENTITY
    IP: ${data.identity?.ip || 'unknown'}
    ISP: ${data.identity?.isp || 'unknown'}
    Location: ${data.identity?.city || 'unknown'},
    ${data.identity?.country || 'unknown'}
    Connection: ${data.identity?.connectionType || 'unknown'}

    PRIVACY AND ROUTING
    VPN: ${data.vpn?.vpnDetected || 'unknown'}
    Proxy: ${data.vpn?.proxyDetected || 'unknown'}
    TOR: ${data.vpn?.torDetected || 'unknown'}
    Trust Score: ${data.vpn?.trustScore || 'unknown'}
    Route: ${data.vpn?.routeClassification || 'unknown'}

    LIVE NETWORK
    Latency: ${data.liveNetwork?.currentRtt || 'unknown'}ms
    Bandwidth: ${data.liveNetwork?.bandwidth || 'unknown'}
    Quality: ${data.liveNetwork?.qualityRating || 'unknown'}
    Stability: ${data.liveNetwork?.stabilityIndex || 'unknown'}

    DEVICE
    OS: ${data.device?.os || 'unknown'}
    Browser: ${data.device?.browser || 'unknown'}
    Type: ${data.device?.deviceType || 'unknown'}
    CPU: ${data.device?.cpuCores || 'unknown'} cores
    RAM: ${data.device?.ram || 'unknown'}GB
    Tier: ${data.device?.capabilityTier || 'unknown'}

    GRAPHICS
    GPU: ${data.graphics?.gpuVendor || 'unknown'}
    WebGL: ${data.graphics?.webglVersion || 'unknown'}
    Graphics Tier: ${data.graphics?.graphicsTier || 'unknown'}

    SECURITY
    HTTPS: ${data.security?.httpsStatus || 'unknown'}
    WebRTC Exposure: ${data.security?.webrtcExposure || 'unknown'}
    Security Score: ${data.security?.securityScore || 'unknown'}
    Risk Level: ${data.security?.riskLevel || 'unknown'}

    CAPABILITIES
    WebGPU: ${data.capabilities?.webgpu || 'unknown'}
    WebAssembly: ${data.capabilities?.wasm || 'unknown'}
    Service Workers: ${data.capabilities?.serviceWorker || 'unknown'}
    Capability Score: ${data.capabilities?.capabilityScore || 'unknown'}

    PERFORMANCE
    Page Load: ${data.performance?.pageLoadTime || 'unknown'}ms
    TTFB: ${data.performance?.ttfb || 'unknown'}ms
    Performance Score: ${data.scores?.performanceScore || 'unknown'}

    SPEED
    LCP: ${data.speed?.lcp || 'unknown'}ms
    FCP: ${data.speed?.fcp || 'unknown'}ms
    Benchmark Score: ${data.speed?.benchmarkScore || 'unknown'}

    GLOBAL SCORES
    Global Score: ${data.scores?.globalScore || 'unknown'}/100
    Health: ${data.scores?.healthClassification || 'unknown'}
    Strongest Area: ${data.scores?.strongestArea || 'unknown'}
    Weakest Area: ${data.scores?.weakestArea || 'unknown'}
  `
}

// System instruction for all prompts
const SYSTEM_INSTRUCTION = `
  You are an expert intelligence analyst
  for a network and device diagnostic system.
  You write clear, accurate, helpful summaries
  based strictly on the data provided.
  You never invent data that was not given.
  You write in plain English.
  You are concise and precise.
  You never use bullet points.
  You never use headers.
  You write in flowing prose only.
`

// Groq API call
const callGroq = async (prompt, apiKey) => {
  if (!apiKey) {
    throw new Error('Groq API key not configured')
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
      `Groq API error ${response.status}: ${errorBody}`
    )
  }

  const data = await response.json()

  if (!data.choices || !data.choices[0]) {
    throw new Error('Groq returned no choices')
  }

  const content = data.choices[0].message?.content
  if (!content || content.trim().length === 0) {
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
    throw new Error('Gemini API key not configured')
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
      `Gemini API error ${response.status}: ${errorBody}`
    )
  }

  const data = await response.json()

  if (!data.candidates || !data.candidates[0]) {
    throw new Error('Gemini returned no candidates')
  }

  const content = data.candidates[0]
    .content?.parts?.[0]?.text

  if (!content || content.trim().length === 0) {
    throw new Error('Gemini returned empty content')
  }

  return {
    summary: content.trim(),
    model: 'gemini-1.5-flash',
    tokensUsed: data.usageMetadata
      ?.totalTokenCount || null,
    source: 'gemini'
  }
}

// Layer 1 script engine fallback summaries
const generateScriptSummary = (type, canvasId, data) => {
  if (type === 'full') {
    const score = data.scores?.globalScore || 0
    const health = data.scores?.healthClassification
      || 'Unknown'
    const city = data.identity?.city || 'Unknown location'
    const country = data.identity?.country || ''
    const isp = data.identity?.isp || 'Unknown ISP'
    const device = data.device?.deviceType || 'device'
    const os = data.device?.os || 'Unknown OS'
    const browser = data.device?.browser || 'Unknown browser'
    const securityRisk = data.security?.riskLevel || 'Unknown'
    const weakest = data.scores?.weakestArea || 'performance'

    return `You are connecting from ${city}${country ? ', ' + country : ''} via ${isp}. Your ${device} running ${os} with ${browser} has been fully analysed. Your environment scores ${score} out of 100 with a ${health} classification. Security risk is rated ${securityRisk}. Your weakest area is ${weakest} which represents the best opportunity for improvement.`
  }

  const summaryMap = {
    canvas1: () => {
      const tier = data.network?.networkTier || 'unknown tier'
      const type = data.network?.asnType || 'unknown type'
      const owner = data.network?.asnOwner || 'unknown provider'
      return `You are on a ${tier} ${type} network operated by ${owner}.`
    },
    canvas2: () => {
      const city = data.identity?.city || 'unknown location'
      const country = data.identity?.country || ''
      const isp = data.identity?.isp || 'unknown ISP'
      const conn = data.identity?.connectionType || 'unknown'
      return `Your internet identity resolves to ${city}${country ? ', ' + country : ''} via ${isp} on a ${conn} connection.`
    },
    canvas3: () => {
      const vpn = data.vpn?.vpnDetected || 'unknown'
      const trust = data.vpn?.trustScore || 0
      const route = data.vpn?.routeClassification || 'unknown'
      return `No VPN or proxy activity detected. Your connection trust score is ${trust} out of 100 with a ${route} route classification.`
        .replace('No VPN', vpn === 'yes' ? 'VPN detected' : 'No VPN')
    },
    canvas4: () => {
      const rtt = data.liveNetwork?.currentRtt || 0
      const quality = data.liveNetwork?.qualityRating || 'unknown'
      const type = data.liveNetwork?.effectiveType || 'unknown'
      return `Your live connection shows ${rtt}ms latency on a ${type} link with ${quality} quality rating.`
    },
    canvas5: () => {
      const os = data.device?.os || 'unknown OS'
      const browser = data.device?.browser || 'unknown browser'
      const cores = data.device?.cpuCores || 'unknown'
      const tier = data.device?.capabilityTier || 'unknown'
      return `You are using ${browser} on ${os} with ${cores} CPU cores — a ${tier} tier device.`
    },
    canvas6: () => {
      const vendor = data.graphics?.gpuVendor || 'unknown GPU'
      const webgl = data.graphics?.webglVersion || 'unknown'
      const gfxTier = data.graphics?.graphicsTier || 'unknown'
      return `Your ${vendor} GPU supports ${webgl} placing your graphics capability in the ${gfxTier} tier.`
    },
    canvas7: () => {
      const https = data.security?.httpsStatus || 'unknown'
      const webrtc = data.security?.webrtcExposure || 'unknown'
      const score = data.security?.securityScore || 0
      return `Your connection is ${https} with a security score of ${score} out of 100. WebRTC exposure is ${webrtc}.`
    },
    canvas8: () => {
      const score = data.capabilities?.capabilityScore || 0
      const webgpu = data.capabilities?.webgpu
      const wasm = data.capabilities?.wasm
      return `Your browser scores ${score} out of 100 on capability detection. WebGPU is ${webgpu ? 'supported' : 'not supported'} and WebAssembly is ${wasm ? 'supported' : 'not supported'}.`
    },
    canvas9: () => {
      const load = data.performance?.pageLoadTime || 0
      const ttfb = data.performance?.ttfb || 0
      const percentile = data.performance?.percentileRating || 'unknown'
      return `Your page loaded in ${load}ms with a ${ttfb}ms time to first byte placing you in the ${percentile} performance percentile.`
    },
    canvas10: () => {
      const lcp = data.speed?.lcp || 0
      const lcpRating = data.speed?.lcpRating || 'unknown'
      const score = data.scores?.speedScore || 0
      return `Your Largest Contentful Paint is ${lcp}ms rated as ${lcpRating} with an overall speed score of ${score} out of 100.`
    },
    canvas11: () => {
      const global = data.scores?.globalScore || 0
      const health = data.scores?.healthClassification || 'unknown'
      const strongest = data.scores?.strongestArea || 'unknown'
      return `Your global environment score is ${global} out of 100 with a ${health} classification. Your strongest area is ${strongest}.`
    },
    canvas12: () => {
      const events = data.events?.length || 0
      const online = data.meta?.isOnline
      return `System is ${online ? 'online' : 'offline'} with ${events} intelligence events logged since page load.`
    }
  }

  const generator = summaryMap[canvasId]
  if (!generator) {
    return 'Intelligence analysis complete for this module.'
  }

  try {
    return generator()
  } catch (err) {
    return 'Intelligence analysis complete for this module.'
  }
}

// Validate incoming request body
const validateRequestBody = (body) => {
  if (!body) {
    return 'Request body is required'
  }
  if (!body.type) {
    return 'Summary type is required'
  }
  if (!['canvas', 'full'].includes(body.type)) {
    return 'Summary type must be canvas or full'
  }
  if (body.type === 'canvas' && !body.canvas) {
    return 'Canvas ID is required for canvas type'
  }
  if (!body.data) {
    return 'Intelligence data is required'
  }
  return null
}

module.exports = async (req, res) => {

  // Handle preflight
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(
      ([key, value]) => res.setHeader(key, value)
    )
    return res.status(200).end()
  }

  // Only accept POST
  if (req.method !== 'POST') {
    Object.entries(CORS_HEADERS).forEach(
      ([key, value]) => res.setHeader(key, value)
    )
    return res.status(405).json({
      error: 'Method not allowed',
      allowedMethods: ['POST']
    })
  }

  const startTime = Date.now()

  Object.entries(CORS_HEADERS).forEach(
    ([key, value]) => res.setHeader(key, value)
  )

  // Validate request body
  const validationError = validateRequestBody(req.body)
  if (validationError) {
    return res.status(400).json({
      success: false,
      error: validationError,
      timestamp: new Date().toISOString()
    })
  }

  const { type, canvas: canvasId, data } = req.body

  // Get API keys
  const groqKey = process.env.GROQ_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY

  // Always generate script summary first
  const scriptSummary = generateScriptSummary(
    type,
    canvasId,
    data
  )

  // Build the appropriate prompt
  let prompt = null

  if (type === 'canvas') {
    prompt = buildCanvasPrompt(canvasId, data)
  } else if (type === 'full') {
    prompt = buildFullSystemPrompt(data)
  }

  if (!prompt) {
    return res.status(200).json({
      success: true,
      summary: scriptSummary,
      source: 'script',
      generatedAt: new Date().toISOString(),
      responseTime: (Date.now() - startTime) + 'ms'
    })
  }

  const errors = []

  // Layer 2 — Groq
  try {
    const groqResult = await callGroq(prompt, groqKey)
    return res.status(200).json({
      success: true,
      summary: groqResult.summary,
      source: groqResult.source,
      model: groqResult.model,
      tokensUsed: groqResult.tokensUsed,
      scriptFallback: scriptSummary,
      generatedAt: new Date().toISOString(),
      responseTime: (Date.now() - startTime) + 'ms'
    })
  } catch (groqError) {
    errors.push({
      layer: 'groq',
      error: groqError.message
    })
  }

  // Layer 3 — Gemini
  try {
    const geminiResult = await callGemini(
      prompt,
      geminiKey
    )
    return res.status(200).json({
      success: true,
      summary: geminiResult.summary,
      source: geminiResult.source,
      model: geminiResult.model,
      tokensUsed: geminiResult.tokensUsed,
      scriptFallback: scriptSummary,
      generatedAt: new Date().toISOString(),
      responseTime: (Date.now() - startTime) + 'ms'
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
    responseTime: (Date.now() - startTime) + 'ms'
  })
}
