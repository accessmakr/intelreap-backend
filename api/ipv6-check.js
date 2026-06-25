// ─────────────────────────────────────────
// API: IPV6 CHECK
// Reports whether the inbound request's
// own connection arrived over IPv4 or IPv6.
//
// IMPORTANT CAVEAT — read before relying on
// this in production: this endpoint can only
// report what the hosting platform's edge
// network actually hands to this function.
// At the time this was written, Vercel's own
// documentation states IPv6 is not yet
// supported for custom domains, while other
// sources describe a dual-stack edge — these
// conflict. If the platform never terminates
// a genuine IPv6 client connection, this will
// always report IPv4 regardless of the
// client's real capability, making the test
// misleading rather than wrong. Verify
// against a real deployment, and against a
// client device with confirmed working IPv6,
// before trusting this signal.
// ─────────────────────────────────────────

const getIpVersion = (ip) => {
  if (!ip) return null
  // IPv6 addresses contain colons,
  // IPv4 addresses do not
  return ip.includes(':') ? 6 : 4
}

module.exports = async (req, res) => {
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
    // Prefer the platform-reported connection
    // address over forwarded headers, since
    // x-forwarded-for can be a comma-separated
    // chain and is technically client-suppliable
    const remoteAddress =
      req.socket?.remoteAddress || null

    const forwardedFor = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for']
          .split(',')[0]
          .trim()
      : null

    const sourceIp = remoteAddress || forwardedFor
    const ipVersion = getIpVersion(sourceIp)

    res.status(200).json({
      ipVersion,
      source: remoteAddress
        ? 'socket.remoteAddress'
        : forwardedFor
        ? 'x-forwarded-for'
        : 'unavailable'
    })

  } catch (error) {
    res.status(500).json({
      error: 'Internal error',
      message: error.message,
      ipVersion: null
    })
  }
}
