// dsh-ballast host half.
//
// JSON endpoint on the webserver (same-origin guarded, the standard DSH
// plugin-route pattern). Every action is read-only and served over
// GET/HEAD only — a non-safe method gets 405, because the route's shape is
// where the "this plugin never writes" boundary is expressed:
//
//   GET /dsh-ballast/api?action=sessions   live sessions on this host
//   GET /dsh-ballast/api?action=measure    per-message window attribution
//                                          (&sessionId=..., required)
//   GET /dsh-ballast/api?action=top        heaviest nodes across all sessions
//                                          (&limit= rows per session, 1..20)
//
// Positioning: 不看花了多少钱，看窗口被谁占了。 Data comes from
// ctx.tokenMeter.measure() — host-only, route-priced, per-message; the official
// contextBreakdown projection deliberately keeps only 3 O(1) numbers and cannot
// answer this.

import { createMeterBridge } from './meter.js'
import { VERSION, sendJson, ballastGuard, createBrowserAuthorizer, requireGet, optionalSessionId } from './shared.js'

// Export a callable default entry. This is the least ambiguous Cordis plugin
// shape across the normal and reload loader paths; named exports remain for
// tooling that inspects module namespaces.
export const inject = ['webServer']

export function apply(ctx) {
  const ws = ctx.webServer
  if (ws === undefined) return

  const startedAt = Date.now()
  const meterBridge = createMeterBridge(ctx)
  const guard = ballastGuard({ currentPort: () => ws.port })
  let connection = null
  let connectionGeneration = 0
  let connectionSeen = false

  // RC1's Connection owns the process launch-token / signed-cookie trust
  // boundary. Older supported hosts have no such capability and keep the
  // plugin's strict loopback guard, so this decides only which of the two
  // authorities the route has, never what either of them concludes.
  ctx.inject(['connection'], (scope) => {
    if (!scope.connection) return
    const mine = ++connectionGeneration
    connectionSeen = true
    connection = scope.connection
    if (typeof scope.on === 'function') {
      scope.on('dispose', () => {
        if (mine !== connectionGeneration) return
        connectionGeneration += 1
        connection = null
      })
    }
  })

  // The whole trust decision for this route, in one call. The order it decides in
  // is the security property, so it is stated once only: in the shared
  // `dsh-host-http` fragment's `createBrowserAuthorizer`.
  const authorizeBrowser = createBrowserAuthorizer({
    getConnection: () => connection,
    getConnectionSeen: () => connectionSeen,
    guard
  })

  const apiRoute = {
    kind: 'exact',
    path: '/dsh-ballast/api',
    handler: async (req, res) => {
      try {
        if (!authorizeBrowser(req, res)) return
        if (!requireGet(req, res)) return
        const u = new URL(req.url || '/', 'http://x')
        const action = u.searchParams.get('action') || 'sessions'

        if (action === 'sessions') {
          sendJson(res, 200, {
            ok: true,
            version: VERSION,
            pid: process.pid,
            port: ws.port,
            startedAt,
            availability: meterBridge.availability(),
            sessions: meterBridge.listSessions()
          })
          return
        }
        if (action === 'measure') {
          const sessionId = optionalSessionId(u.searchParams.get('sessionId'))
          if (sessionId === null) {
            sendJson(res, 400, { ok: false, code: 'session_required', error: 'sessionId is required' })
            return
          }
          const result = meterBridge.measure(sessionId)
          if (!result.ok) {
            const status = result.code === 'no_live_session' ? 404
              : result.code === 'unavailable' ? 503
              : result.code === 'measure_failed' ? 500
              : 400
            sendJson(res, status, {
              ok: false,
              code: result.code,
              ...(result.error ? { error: result.error } : {})
            })
            return
          }
          sendJson(res, 200, { ok: true, version: VERSION, ...result })
          return
        }
        if (action === 'top') {
          const limit = boundedLimit(u.searchParams.get('limit'))
          const result = meterBridge.top(limit)
          if (!result.ok) {
            sendJson(res, 503, { ok: false, code: result.code })
            return
          }
          sendJson(res, 200, { ok: true, version: VERSION, ...result })
          return
        }
        sendJson(res, 400, { ok: false, code: 'bad_action', error: `unknown action "${action}"` })
      } catch (e) {
        // The reply body carries a fixed code only. An exception message can name
        // a host path, a service field or an upstream status, and this body goes
        // to whatever asked — the read side belongs in the host log, where an
        // operator can see it, not in the browser's response.
        console.error('[dsh-ballast] api route failed:', String((e && e.stack) || (e && e.message) || e))
        sendJson(res, 500, { ok: false, code: 'error' })
      }
    }
  }
  const disposeRoute = ws.register(apiRoute)

  // cordis idiom (matches the DSH host source). on('dispose') also works,
  // but effect() is what the upstream host uses.
  ctx.effect(() => () => {
    if (typeof disposeRoute === 'function') disposeRoute()
  })
}

apply.inject = inject

/**
 * Rows per session for `action=top`. The cap keeps the payload from being
 * driven by the query string; the floor keeps a `limit=0` from looking like an
 * empty host rather than a bad request.
 */
function boundedLimit(value) {
  // Number(null) and Number('') are both 0, so an absent parameter has to be
  // taken as the default before conversion or it lands on the floor instead.
  if (value === null || value === undefined || value === '') return 5
  const n = Number(value)
  if (!Number.isFinite(n)) return 5
  return Math.min(20, Math.max(1, Math.trunc(n)))
}

export default apply
