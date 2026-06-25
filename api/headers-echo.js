// ─────────────────────────────────────────
// API: HEADERS ECHO
// Returns the inbound request's own HTTP
// headers back to the caller. Browser
// JavaScript cannot read the headers its
// own page request sent — only the server
// receiving that request can see them.
// No external calls, no caching needed —
// this is a same-request echo only.
// ─────────────────────────────────────────

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, OPTIONS'
  )
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  )

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({
      error: 'Method not allowed'
    })
    return
  }

  try {
    // Only return headers that are safe and
    // meaningful to display back to the user.
    // We deliberately exclude cookie and auth
    // headers even though none are expected
    // on this public endpoint, as a precaution.
    const safeKeys = [
      'accept',
      'accept-language',
      'accept-encoding',
      'user-agent',
      'referer',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'dnt',
      'upgrade-insecure-requests'
    ]

    const headers = {}
    safeKeys.forEach(key => {
      if (req.headers[key] !== undefined) {
        headers[key] = req.headers[key]
      }
    })

    res.status(200).json({
      headers,
      count: Object.keys(headers).length
    })

  } catch (error) {
    res.status(500).json({
      error: 'Internal error',
      message: error.message
    })
  }
}
