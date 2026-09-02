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
 * reject browser-initiated cross-site traffic via Fetch Metadata, a foreign
 * Origin, or a non-loopback Host header (also closes DNS rebinding).
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

export function createGuard({ currentPort } = {}) {
  const getCurrentPort = typeof currentPort === 'function' ? currentPort : () => currentPort
  return function guard(req, res) {
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
        originPort = parsed.port
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
