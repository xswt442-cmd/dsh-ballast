// dsh-ballast host half.
//
// JSON endpoint on the webserver (same-origin guarded, the
// dsh-instance-manager pattern). M0 is strictly read-only:
//
//   GET /dsh-ballast/api?action=sessions   live sessions usable for measurement
//   GET /dsh-ballast/api?action=measure    per-message window attribution
//                                          (&sessionId=..., required)
//
// Positioning (testplace/dsh-ballast-m0.md): 不看花了多少钱，看窗口被谁占了。
// Data comes from ctx.tokenMeter.measure() — host-only, route-priced,
// per-message; the official contextBreakdown projection deliberately keeps
// only 3 O(1) numbers and cannot answer this.

import { createMeterBridge } from './meter.js'
import { VERSION, sendJson, createGuard, optionalSessionId } from './shared.js'

// Export a callable default entry. This is the least ambiguous Cordis plugin
// shape across the normal and reload loader paths; named exports remain for
// tooling that inspects module namespaces.
export const inject = ['webServer']

export function apply(ctx) {
  const ws = ctx.webServer
  if (ws === undefined) return

  const startedAt = Date.now()
  const meterBridge = createMeterBridge(ctx)
  const guard = createGuard()

  const apiRoute = {
    kind: 'exact',
    path: '/dsh-ballast/api',
    handler: async (req, res) => {
      try {
        if (!guard(req, res)) return
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
        sendJson(res, 400, { ok: false, code: 'bad_action', error: `unknown action "${action}"` })
      } catch (e) {
        sendJson(res, 500, { ok: false, code: 'error', error: String((e && e.message) || e) })
      }
    }
  }
  const disposeRoute = ws.register(apiRoute)

  ctx.on('dispose', () => {
    if (typeof disposeRoute === 'function') disposeRoute()
  })
}

apply.inject = inject

export default apply
