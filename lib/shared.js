// dsh-ballast 的宿主共享辅助函数。本文件自己维护的只有 ballast 专属内容：
// 版本号、守卫的错误词汇（`BALLAST_POLICY`）、`ballastGuard` 以及只读方法
// 闸门（`requireGet`）。
//
// loopback 谓词、请求守卫与 HTTP 胶水不在这里编写，而是下方三个带标记的
// 片段：它们从 dsh-mini-utility-dock 嵌入，让 loopback 判定、执行与响应策略
// 各自只有一个来源，本插件只贡献自己的词汇。不要编辑这些片段：下一次同步
// 会覆盖它们。
//
// `*.sync` 与 `*:check` 只处理本仓库锁定的 dock 版本认识的片段；比锁定版本
// 更新的片段会被静默跳过，所以检查通过不代表每个片段都比对过。

export const VERSION = '0.5.0'

// <dsh-loopback-helpers>
// The loopback predicates: which Host names and which peer addresses count as
// loopback, for a plugin's host half that binds an API to the loopback interface.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/loopback.js.
// A host half is plain Node ESM that its package ships standalone, so the
// fragment is embedded into `lib/shared.js` at build time by
//   npm run loopback:sync    (write it)
//   npm run loopback:check   (fail on drift)
// instead of being imported: a bare `import 'dsh-mini-utility-dock/...'` would
// put a runtime dependency on this package into the file that embeds it, and an
// embedding plugin ships standalone, with nothing else required.
//
// "Loopback" is decided in exactly one place — LOOPBACK_HOSTNAMES plus the
// IPv4-mapped IPv6 form of each entry — and both the name and the address
// predicate route through it, so the Host path and the peer path cannot
// disagree. Every spelling this file accepts is a documented one; anything
// unrecognised fails closed.
//
// Kept a separate fragment from the host guard on purpose: the predicates are
// stable facts about what an address is, while the guard is a policy about who
// may call an API. The guard block reads the names this block declares, so it
// depends on this block and never the other way round.

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
 * Accepts the documented spellings, the IPv4-mapped IPv6 form of 127.0.0.1, and
 * folds case. Fails closed on everything else, including a missing name.
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

// <dsh-host-guard>
// Host-side same-origin request guard, for a plugin's host half that binds an
// API to loopback.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/guard.js.
// A host half is plain Node ESM that its package ships standalone, so the
// fragment is embedded into `lib/shared.js` at build time by
//   npm run guard:sync    (write it)
//   npm run guard:check   (fail on drift)
// instead of being imported: a bare `import 'dsh-mini-utility-dock/...'` would
// put a runtime dependency on this package into the file that embeds it, and an
// embedding plugin ships standalone, with nothing else required.
//
// This file is the POLICY half. What counts as loopback is a separate fragment
// (`dist/loopback.js`, embedded under the `dsh-loopback-helpers` marker), and
// this module uses the predicates that block exports in the same file rather than
// restating them: `hostHostname`, `isLoopbackName` and `isLoopbackAddress` are
// module-scope names here, declared by the block above. That keeps one copy of
// them in a consumer, and makes the dependency one-way and visible — `guard:sync`
// needs `loopback:sync` to have produced a `lib/shared.js` that declares them.
//
// There is deliberately no `import` here. A consumer embeds both blocks into one
// file, so an import of another module would both break the standalone promise
// and collide with the exports the block above already declares.
//
// The enforcement order and every decision are fixed here, and the wording is
// supplied as data by the caller (`policy`): a plugin customizes the codes and
// messages its own API publishes without forking the checks. Keeping the
// vocabulary out of the decisions is what makes one copy of them enough.

// Default ports each scheme normalises away, so an Origin carrying no explicit
// port (for example `http://127.0.0.1`) compares equal to a server on 80/443.
// `new URL('http://127.0.0.1:80').port` is '', which would read as unequal to
// `80` and reject a legitimate same-origin request.
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' }
export const portOf = (url) => url.port || DEFAULT_PORTS[url.protocol] || ''

// The reasons this guard can reject. Each is a stable, guard-owned name for one
// decision; the *reason* is fixed here, while the machine-readable `code` a
// plugin's API exposes and the human wording are policy.
//
// An unidentifiable peer and an off-loopback peer are deliberately distinct
// decisions, because they are distinct facts about the request. A caller may map
// both to the same `code`: that is a vocabulary choice about its published API,
// and nothing widens either way, because every reason rejects.
export const GUARD_REASONS = Object.freeze([
  'non_loopback_peer',
  'cross_site',
  'unknown_peer',
  'foreign_origin',
  'non_loopback_host'
])

/** Default machine-readable codes and wording, in English, per reason. */
export const DEFAULT_GUARD_POLICY = Object.freeze({
  non_loopback_peer: { code: 'non_loopback_peer', error: 'non-loopback peer rejected' },
  cross_site: { code: 'cross_site', error: 'cross-site request rejected' },
  unknown_peer: { code: 'unknown_peer', error: 'peer address is not identifiable' },
  foreign_origin: { code: 'foreign_origin', error: 'foreign origin rejected' },
  non_loopback_host: { code: 'non_loopback_host', error: 'non-loopback host rejected' }
})

/**
 * Build the same-origin request guard for a loopback-bound API route.
 *
 * Not exported under a plugin-facing name: each plugin publishes its own guard
 * bound to its own error vocabulary, so the name it exports — `createGuard` is
 * the conventional one — is the plugin's own to declare. This is the one factory
 * every plugin that embeds this block calls.
 *
 * Enforces, in order: Fetch Metadata, an unparseable Host, the TCP peer address,
 * then the Host allowlist, then the Origin. Rejects by calling
 * `respond(res, 403, { ok: false, code, error })` and returning false; returns
 * true when the request may proceed.
 *
 * @param currentPort - the port this server listens on. A function is called per
 *   request so an Origin check follows a server whose port changes; a plain
 *   value is accepted for a fixed server.
 * @param respond - rejection sink, normally the plugin's `sendJson`. Kept
 *   injectable so tests can capture the rejection code instead of standing up a
 *   real ServerResponse.
 * @param allowRemoteHost - optional predicate. When it returns true, an
 *   off-loopback peer AND an off-loopback Host are admitted, because the caller
 *   has opted into verifying its own credential per request; the guard
 *   deliberately knows nothing about tokens. The Origin check still applies, so
 *   the exemption never widens the browser-facing boundary. A plugin that omits
 *   the predicate keeps absolute peer and Host criteria.
 * @param policy - optional per-reason `{ code, error }` overrides, keyed by
 *   `GUARD_REASONS`. A partial override merges with the default, so a plugin
 *   names only the reasons whose vocabulary differs. An unknown key throws: a
 *   typo would otherwise silently leave the default in place, and the plugin
 *   would expose a code no test expects.
 */
const bindGuard = ({ currentPort, respond, allowRemoteHost, policy } = {}) => {
  const port = typeof currentPort === 'function' ? currentPort : () => currentPort
  const overrides = policy || {}
  for (const key of Object.keys(overrides)) {
    if (!GUARD_REASONS.includes(key)) {
      throw new Error(`bindGuard: unknown policy key ${JSON.stringify(key)}; expected one of ${GUARD_REASONS.join(', ')}`)
    }
  }
  const say = Object.fromEntries(GUARD_REASONS.map((reason) => [
    reason,
    { ...DEFAULT_GUARD_POLICY[reason], ...(overrides[reason] || {}) }
  ]))
  const deny = (res, reason) => {
    respond(res, 403, { ok: false, code: say[reason].code, error: say[reason].error })
    return false
  }
  const fleetAllowed = () => typeof allowRemoteHost === 'function' && allowRemoteHost()

  return function guard(req, res) {
    const headers = (req && req.headers) || {}

    const site = headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return deny(res, 'cross_site')
    }

    const host = headers.host || ''
    const parsedHost = host ? hostHostname(host) : ''
    // An empty parse is not permission. A Host header that carries no usable
    // hostname — an unbracketed IPv6 literal such as `::1:3080`, which RFC 7230
    // forbids but a client can still send — parses to '', and reading that as a
    // pass would skip the allowlist. It is a Host problem, so it is reported as
    // one. An ABSENT Host stays loopback so host-side callers keep working.
    if (host && parsedHost === '') {
      return deny(res, 'non_loopback_host')
    }
    const peerAddress = req.socket ? req.socket.remoteAddress : undefined
    if (peerAddress == null || String(peerAddress).trim() === '') {
      return deny(res, 'unknown_peer')
    }
    // `allowRemoteHost` buys exactly one thing: an off-loopback peer AND an
    // off-loopback Host stop being *rejected* by this guard — both checks below
    // are skipped — because the caller has opted into verifying its own
    // credential per request. Everything else still applies: the Origin check
    // below rejects cross-site traffic in both modes, so the exemption never
    // widens the browser-facing boundary. A plugin that does not pass the
    // predicate never enters this mode, so for it the peer and Host criteria
    // are absolute.
    const remote = fleetAllowed()
    if (!remote && !isLoopbackAddress(peerAddress)) {
      return deny(res, 'non_loopback_peer')
    }
    const hostLoopback = host ? (parsedHost !== '' && isLoopbackName(parsedHost)) : true
    if (!remote && !hostLoopback) {
      return deny(res, 'non_loopback_host')
    }

    const origin = headers.origin
    if (origin) {
      let same = false
      try {
        const parsed = new URL(origin)
        same = isLoopbackName(hostHostname(parsed.hostname)) &&
          portOf(parsed) === String(port() || '')
      } catch {
        same = false
      }
      if (!same) return deny(res, 'foreign_origin')
    }

    return true
  }
}
// </dsh-host-guard>

// <dsh-host-http>
// Host-side HTTP glue, for a plugin's host half that answers its own API.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/host-http.js.
// A host half is plain Node ESM that its package ships standalone, so the
// fragment is embedded into `lib/shared.js` at build time by
//   npm run http:sync    (write it)
//   npm run http:check   (fail on drift)
// instead of being imported: a bare `import 'dsh-mini-utility-dock/...'` would
// put a runtime dependency on this package into the file that embeds it, and an
// embedding plugin ships standalone, with nothing else required.
//
// There is deliberately no `import` here. The block sits BELOW `dsh-host-guard`
// in the consumer's `lib/shared.js` and declares nothing the blocks above it
// already declared, so the three host-side blocks coexist in one file and a
// plugin that needs only this one can embed only this one.
//
// These lines are the response policy, so they are stated once here: every JSON
// reply carries `cache-control: no-store`, because a body naming instance ports,
// pids or session ids must never be servable from an intermediary cache — that
// header is a security posture, not cosmetics. The "browser authorization is
// unavailable" reply and the POST gate each have one definition, so a change to
// one reaches every file that embeds this block at the same time.
//
// What legitimately differs between plugins — a machine-readable `code`, the
// human wording, whether the rejected `action` is echoed — is supplied as data
// (`policy`), exactly the way `dist/guard.js` separates enforcement from
// vocabulary.

/**
 * Send a JSON reply and end the response.
 *
 * `cache-control: no-store` is part of this function rather than of each call
 * site: a route that reports live host facts (ports, pids, session data) must
 * not be servable from an intermediary cache, and a two-line helper that each
 * call site restates is where such a header goes missing.
 */
export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(text)
}

/**
 * The one reply for "browser authorization is unavailable right now". Exported
 * as data so a call site that cannot go through `connectionUnavailable()` — a
 * test, or a route that composes its own body — still states it once.
 */
export const CONNECTION_UNAVAILABLE = Object.freeze({
  ok: false,
  code: 'connection_unavailable',
  error: 'browser authentication unavailable'
})

/**
 * Answer `res` with 503 and the shared `connection_unavailable` payload, and
 * return false so a caller can hand its own verdict back in one statement.
 * `respond` has the same injectable sink shape as the guard block's `bindGuard`
 * — `(res, status, body)` — and it defaults to this block's `sendJson`, so the
 * no-store policy is not something a call site can drop.
 */
export const connectionUnavailable = (res, respond = sendJson) => {
  respond(res, 503, { ...CONNECTION_UNAVAILABLE })
  return false
}

/**
 * The reasons the POST gate can reject. One today; the table exists so the
 * wording is overridable by key and a typo in that key is an error rather than a
 * silent no-op — the same contract the guard block's `GUARD_REASONS` offers.
 */
export const REQUIRE_POST_REASONS = Object.freeze(['method_not_allowed'])

/** Default code and wording. `{action}` in `error` is substituted per call. */
export const DEFAULT_REQUIRE_POST_POLICY = Object.freeze({
  method_not_allowed: { code: 'method', error: 'action "{action}" requires POST' }
})

/**
 * Build the POST-only gate for a mutating action.
 *
 * Behavior is fixed: the method is read case-insensitively (an absent method
 * reads as `GET`, which is not POST), POST passes, anything else is answered
 * 405 and returns false. What a plugin publishes — the `code`, the language of
 * `error`, and whether the rejected `action` is echoed in the body — is policy:
 *
 *   createRequirePost()                                          // `{ code: 'method' }`
 *   createRequirePost({ policy: { method_not_allowed: {          // an established API keeps its shape
 *     code: 'need_post', error: '{action} 需要 POST 请求', includeAction: true
 *   } } })
 *
 * @param respond - rejection sink, defaults to this block's `sendJson`, so the
 *   `no-store` header is not a thing a caller can forget to pass.
 * @param policy - optional per-reason `{ code, error, includeAction }` overrides
 *   keyed by `REQUIRE_POST_REASONS`; a partial override merges with the default,
 *   and an unknown key throws.
 */
export const createRequirePost = ({ respond = sendJson, policy } = {}) => {
  const overrides = policy || {}
  for (const key of Object.keys(overrides)) {
    if (!REQUIRE_POST_REASONS.includes(key)) {
      throw new Error(`createRequirePost: unknown policy key ${JSON.stringify(key)}; expected one of ${REQUIRE_POST_REASONS.join(', ')}`)
    }
  }
  const say = Object.fromEntries(REQUIRE_POST_REASONS.map((reason) => [
    reason,
    { ...DEFAULT_REQUIRE_POST_POLICY[reason], ...(overrides[reason] || {}) }
  ]))
  const render = (template, action) => String(template).replace(/\{action\}/g, action == null ? '' : String(action))

  return function requirePost(req, res, action) {
    if (String((req && req.method) || 'GET').toUpperCase() === 'POST') return true
    const words = say.method_not_allowed
    respond(res, 405, {
      ok: false,
      code: words.code,
      error: render(words.error, action),
      ...(words.includeAction ? { action } : {})
    })
    return false
  }
}

/**
 * Build the browser authorizer for a route that is guarded by RC1's Connection
 * when the host provides one, and by the plugin's own same-origin guard when it
 * does not.
 *
 * @param getConnection - `() => connection`, an ACCESSOR, never the value. A host
 *   half keeps its Connection in a closure variable that service unload/reload
 *   reassigns to `null` and later back to a new instance; a captured value would
 *   keep authorizing against a disposed Connection forever.
 * @param getConnectionSeen - `() => connectionSeen`, an accessor for the latch
 *   that records "this host has had an RC1 Connection at least once". Same
 *   reason, same consequence: read it per request.
 * @param guard - the plugin's bound request guard, used only on a host that has
 *   never had a Connection (older hosts, where the guard IS the boundary).
 * @param respond - rejection sink, defaults to this block's `sendJson`.
 * @returns `(req, res) => boolean`, true when the request may proceed.
 *
 * The decision order is the security property, so it is fixed here:
 *
 *   1. A Connection that throws is not a Connection that permits. The request is
 *      rejected 503 and must never fall through to the route handler.
 *   2. A rejection code from the Connection is final: the status is that code,
 *      401 reads as `unauthorized`, anything else as `forbidden`.
 *   3. No Connection but a seen one: 503, and deliberately NOT the guard. Once
 *      the host has had an RC1 Connection, an unload gap must not reopen the
 *      route through the weaker loopback fence — a local socket peer is not the
 *      same statement as an authorized browser.
 *   4. No Connection and none ever seen: this is a pre-RC1 host, and the
 *      plugin's own guard is the whole boundary, so it decides.
 *
 * These two codes and their wording state the decision itself rather than a
 * plugin's published vocabulary, so they are not policy and are not injectable;
 * only wording that legitimately differs between plugins belongs in a table.
 */
export const createBrowserAuthorizer = ({ getConnection, getConnectionSeen, guard, respond = sendJson }) => {
  if (typeof getConnection !== 'function') {
    throw new Error('createBrowserAuthorizer: getConnection must be an accessor (`() => connection`); a Connection captured here is stale the first time the service reloads')
  }
  if (typeof getConnectionSeen !== 'function') {
    throw new Error('createBrowserAuthorizer: getConnectionSeen must be an accessor (`() => connectionSeen`); the latch is set once an RC1 Connection exists and must never be read from a captured copy')
  }
  if (typeof guard !== 'function') {
    throw new Error('createBrowserAuthorizer: guard is required; a host without an RC1 Connection falls back to the plugin request guard')
  }

  return function authorizeBrowser(req, res) {
    const connection = getConnection()
    if (connection) {
      let rejection
      try {
        rejection = connection.requestRejection(req)
      } catch {
        return connectionUnavailable(res, respond)
      }
      if (rejection !== undefined) {
        respond(res, rejection, {
          ok: false,
          code: rejection === 401 ? 'unauthorized' : 'forbidden',
          error: rejection === 401 ? 'browser authentication required' : 'request rejected'
        })
        return false
      }
      return true
    }
    // Once an RC1 Connection has existed, a reload gap answers 503 — it does not
    // downgrade to the guard fence.
    if (getConnectionSeen()) return connectionUnavailable(res, respond)
    return guard(req, res)
  }
}

/**
 * Accept only a bounded, plausible session id from query or body input.
 * Returns the trimmed value or null; `null` is the caller's "missing/invalid"
 * signal, so an empty string never reaches a lookup.
 */
export function optionalSessionId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512) return null
  return trimmed
}
// </dsh-host-http>

// 只有这两条拒绝文案是 ballast 自己的。其余沿用共享默认值，新的拒绝原因
// 就不会悄悄产生另一套措辞。
const BALLAST_POLICY = {
  // 已发布的 API 在两种情况下都回答 `non_loopback_peer`：无法识别 peer 与
  // peer 不在 loopback 上。两者都拒绝，沿用单一 code 保持对外形状不变。
  unknown_peer: { code: 'non_loopback_peer', error: 'non-loopback peer rejected' },
  non_loopback_host: { code: 'non_loopback', error: 'non-loopback host rejected' }
}

/**
 * ballast 用于 /api 路由的同源守卫。
 *
 * 执行逻辑在共享片段里；这里只绑定 ballast 自己的两件事：用 `sendJson`
 * 作答，并对不予放行的 Host 保持既有的 `non_loopback` code，让调用点无法
 * 意外改用别的措辞。
 */
export const ballastGuard = (options = {}) => bindGuard({
  ...options,
  respond: sendJson,
  policy: BALLAST_POLICY
})

/**
 * 只读路由只放行安全方法，其余回答 405 与 Allow。
 * “本插件只读、从不写入”是产品承诺，一个用 200 回答写请求的路由表达不了
 * 这条边界。
 *
 * 这个函数留在本文件而不并入共享片段：ballast 没有写入型动作，共享的 POST
 * 闸门（`createRequirePost`）在本仓库没有调用点，而 `requireGet` 表达的
 * 是只有 ballast 主张的边界。
 */
export function requireGet(req, res) {
  const method = String(req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return true
  res.setHeader('allow', 'GET, HEAD')
  sendJson(res, 405, { ok: false, code: 'method', error: `${method} is not allowed; this API is read-only` })
  return false
}
