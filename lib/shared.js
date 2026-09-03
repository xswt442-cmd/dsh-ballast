// dsh-ballast shared helpers: version, same-origin guard, JSON replies, method
// gates. `requireGet` is ballast-only; the guard follows the strict loopback
// rules used by dsh-instance-manager.

export const VERSION = '0.2.5'

/** Send a JSON reply and end the response. */
export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(text)
}

/**
 * Same-origin guard for the /api route (the dsh-instance-manager pattern):
 * reject any non-loopback network peer outright, then reject
 * browser-initiated cross-site traffic via Fetch Metadata, a foreign Origin,
 * or a non-loopback Host header (also closes DNS rebinding).
 * Peer/host-side callers (plain node:http) carry none of these headers and
 * keep working.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function hostHostname(host) {
  const value = String(host || '')
  const ipv6 = /^\[([^\]]+)\](?::\d+)?$/.exec(value)
  return (ipv6 ? ipv6[1] : value.split(':')[0]).toLowerCase()
}

function isLoopbackName(name) {
  return LOOPBACK_HOSTNAMES.has(String(name || '').toLowerCase())
}

/**
 * True when `address` is a real loopback TCP peer address.
 * Headers cannot identify the network peer — a client sets `Host` freely — so
 * the socket address is the only trustworthy signal. Fail closed on anything
 * unrecognised, including a missing address.
 */
export const isLoopbackAddress = (address) => {
  const value = String(address == null ? '' : address).trim().toLowerCase()
  if (!value) return false
  if (value === '::1') return true
  // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is how Node reports a v4 peer on a
  // dual-stack socket; fold it back before the 127/8 test.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)
  if (mapped) return /^127\./.test(mapped[1])
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

export function createGuard({ currentPort } = {}) {
  const getCurrentPort = typeof currentPort === 'function' ? currentPort : () => currentPort
  // `new URL('http://127.0.0.1:80').port` is '', so a same-origin request on a
  // default port has to be compared against the scheme's implied port or it
  // reads as a foreign origin.
  const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' }
  const portOf = (url) => url.port || DEFAULT_PORTS[url.protocol] || ''
  return function guard(req, res) {
    // The peer address, not the Host header, decides whether this is a local
    // request: DSH supports listening on 0.0.0.0, where any remote client can
    // send `Host: 127.0.0.1`.
    if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, code: 'non_loopback_peer', error: 'non-loopback peer rejected' })
      return false
    }
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      sendJson(res, 403, { ok: false, code: 'cross_site', error: 'cross-site request rejected' })
      return false
    }
    const origin = req.headers.origin
    if (origin) {
      let host = ''
      let originPort = ''
      try {
        const parsed = new URL(origin)
        host = parsed.hostname
        originPort = portOf(parsed)
      } catch { host = '' }
      const normalizedOriginHost = host.replace(/^\[|\]$/g, '').toLowerCase()
      if (!host || !isLoopbackName(normalizedOriginHost) || originPort !== String(getCurrentPort() || '')) {
        sendJson(res, 403, { ok: false, code: 'foreign_origin', error: 'foreign origin rejected' })
        return false
      }
    }
    const reqHost = hostHostname(req.headers.host)
    if (req.headers.host && !isLoopbackName(reqHost)) {
      sendJson(res, 403, { ok: false, code: 'non_loopback', error: 'non-loopback host rejected' })
      return false
    }
    return true
  }
}

/** Gate a mutating action behind POST; replies 405 on mismatch. */
export function requirePost(req, res, action) {
  if ((req.method || 'GET').toUpperCase() === 'POST') return true
  sendJson(res, 405, { ok: false, code: 'method', error: `action "${action}" requires POST` })
  return false
}

/**
 * Admit only safe methods on a read-only route; 405 + Allow otherwise.
 * The boundary "this plugin reads, never writes" is a product claim, and a
 * route that answers a mutation-shaped request with a 200 does not express it.
 */
export function requireGet(req, res) {
  const method = String(req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return true
  res.setHeader('allow', 'GET, HEAD')
  sendJson(res, 405, { ok: false, code: 'method', error: `${method} is not allowed; this API is read-only` })
  return false
}

/** Accept only a bounded, plausible session id from query/body input. */
export function optionalSessionId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512) return null
  return trimmed
}
