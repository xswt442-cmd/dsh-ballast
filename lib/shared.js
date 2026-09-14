// dsh-ballast shared helpers: version, same-origin guard, JSON replies, method
// gates. `requireGet` is ballast-only; the guard follows the strict loopback
// rules used by dsh-instance-manager.
//
// The loopback predicates are not written here. They are embedded from
// dsh-mini-utility-dock at build time (see the marked block below) because three
// plugins kept three hand-maintained copies and they drifted twice — once
// rejecting IPv6 loopback everywhere, once disagreeing on which Host spellings
// count as loopback. Edit the dock fragment, then run `npm run loopback:sync`.

export const VERSION = '0.2.6'

// <dsh-loopback-helpers>
// Loopback predicates shared by the host halves of the DSH plugins.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/loopback.js.
// DSH plugin host halves are plain Node ESM that each package ships standalone,
// so the fragment is embedded into `lib/shared.js` at build time by
//   npm run loopback:sync    (write it)
//   npm run loopback:check   (fail on drift)
// instead of being imported: a bare `import 'dsh-mini-utility-dock/...'` would
// put a runtime dependency on the dock into every plugin, and the whole point
// of the dock is that a plugin works with no sibling installed.
//
// Why it is shared at all: these predicates were copy-pasted per repo and
// drifted twice. The first drift rejected IPv6 loopback in all three plugins;
// the second made the three disagree on which Host spellings count as loopback
// (see scripts/guard-parity.mjs, which compares this block across repos).
//
// "Loopback" is decided in exactly one place — LOOPBACK_HOSTNAMES plus the
// IPv4-mapped IPv6 form of each entry — and both the name and the address
// predicate route through it, so the Host path and the peer path cannot drift
// apart again.

// Hostnames a request to a loopback-bound API may legitimately arrive with.
// Exact spellings only: `api.localhost` and `127.0.0.1.evil.example` must stay
// rejected, which is what keeps DNS rebinding out of the API surface.
export const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '::1']

// Canonicalize a Host-like value. Trims both ends and lowercases, so the
// allowlist match is case-insensitive and tolerates surrounding whitespace.
export const normalizeHostValue = (value) => String(value == null ? '' : value).trim().toLowerCase()

// Pull the hostname out of a Host header: "127.0.0.1:3080" -> "127.0.0.1",
// "[::1]:3080" -> "::1". A bracketed IPv6 literal carries its colons inside the
// brackets, so the brackets decide where the host ends, not the first colon.
export const hostHostname = (host) => {
  const value = normalizeHostValue(host)
  const bracketed = /^\[([^\]]+)\]/.exec(value)
  return bracketed ? bracketed[1] : value.split(':')[0]
}

// The IPv4 address inside an IPv4-mapped IPv6 literal, or null. Node reports a
// v4 peer on a dual-stack socket in the mapped form, so this is a routine input,
// not an exotic one. Two spellings reach us and both must work:
//
//   ::ffff:127.0.0.1   what Node puts in req.socket.remoteAddress, and what a
//                      client may legally write in a Host header
//   ::ffff:7f00:1      what the WHATWG URL parser normalises the above to, so
//                      this is the shape a browser's Origin header produces
//
// The v4 part is validated as four decimal octets, so `::ffff:1.2.3` and
// `::ffff:999.1.1.1` are not addresses and fail closed.
const mappedIpv4 = (value) => {
  if (!value.startsWith('::ffff:')) return null
  const rest = value.slice(7)
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) {
    return rest.split('.').every((octet) => Number(octet) <= 255) ? rest : null
  }
  // Hex form: ::ffff:7f00:1 -> 127.0.0.1. Exactly two groups, four hex digits
  // each, as the URL parser emits.
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest)
  if (!hex) return null
  const high = parseInt(hex[1], 16)
  const low = parseInt(hex[2], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/**
 * True when `name` is a loopback hostname — the Host-header side of the guard.
 * Accepts the documented spellings, the IPv4-mapped IPv6 form of any of them,
 * and folds case. Fails closed on everything else, including a missing name.
 */
export const isLoopbackName = (name) => {
  const value = normalizeHostValue(name)
  if (!value) return false
  if (LOOPBACK_HOSTNAMES.indexOf(value) !== -1) return true
  const ipv4 = mappedIpv4(value)
  return ipv4 !== null && LOOPBACK_HOSTNAMES.indexOf(ipv4) !== -1
}

/**
 * True when `address` is a real loopback TCP peer address.
 * Headers cannot identify the network peer — a client sets `Host` freely — so
 * the socket address is the only trustworthy signal. Fail closed on anything
 * unrecognised, including a missing address.
 */
export const isLoopbackAddress = (address) => {
  const value = normalizeHostValue(address)
  if (!value) return false
  if (value === '::1') return true
  // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is how Node reports a v4 peer on a
  // dual-stack socket; fold it back before the 127/8 test.
  const mapped = mappedIpv4(value)
  if (mapped !== null) return /^127\./.test(mapped)
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}
// </dsh-loopback-helpers>

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
    const rawHost = req.headers.host
    if (rawHost) {
      const reqHost = hostHostname(rawHost)
      // An empty parse is not permission. A Host header that carries no usable
      // hostname — an unbracketed IPv6 literal such as `::1:3080`, which RFC 7230
      // forbids but a client can still send — parses to '', and a bare truthiness
      // test would skip the allowlist entirely. Fail closed instead.
      if (!reqHost || !isLoopbackName(reqHost)) {
        sendJson(res, 403, { ok: false, code: 'non_loopback', error: 'non-loopback host rejected' })
        return false
      }
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
