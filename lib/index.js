// dsh-ballast 宿主端。
//
// webserver 上的 JSON 端点，采用 DSH 插件路由的标准形式：同源守卫，只读，
// 只接受 GET/HEAD——非安全方法返回 405，因为“本插件从不写入”这条边界由
// 路由的形状表达：
//
//   GET /dsh-ballast/api?action=sessions   本宿主上的活跃会话
//   GET /dsh-ballast/api?action=measure    按消息归因窗口占用
//                                          （&sessionId=...，必填）
//   GET /dsh-ballast/api?action=top        所有会话中最重的节点
//                                          （&limit= 每个会话的行数，1..20）
//   GET /dsh-ballast/api?action=cold       没有活跃 agent 的已存储会话
//   GET /dsh-ballast/api?action=cold-measure
//                                          按需计量已存储会话
//                                          （&sessionIds= 逗号分隔，1..20）
//
// 定位：不看花了多少钱，看窗口被谁占了。数据来自 ctx.tokenMeter.measure()：
// 仅宿主可用、按路由定价、逐条消息；官方 contextBreakdown 投影只保留 3 个
// O(1) 数字，回答不了这个问题。

import { createMeterBridge } from './meter.js'
import { VERSION, sendJson, ballastGuard, createBrowserAuthorizer, requireGet, optionalSessionId } from './shared.js'

// webServer 是唯一必需的服务：路由注册在它上面。
export const inject = ['webServer']

export function apply(ctx) {
  const ws = ctx.webServer

  const startedAt = Date.now()
  const meterBridge = createMeterBridge(ctx)
  const guard = ballastGuard({ currentPort: () => ws.port })
  let connection = null
  let connectionGeneration = 0
  let connectionSeen = false

  // RC1 的 Connection 负责进程启动令牌与签名 cookie 的信任边界。较早的受支持
  // 版本没有这个能力，继续使用插件自己的严格 loopback 守卫；这里只决定路由
  // 采用哪一种授权来源，不决定任何一方的结论。
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

  // 这条路由的全部信任判断集中在一处。判断顺序就是安全属性，只在共享的
  // `dsh-host-http` 片段的 `createBrowserAuthorizer` 里写一次。
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
            sessions: await meterBridge.listSessions()
          })
          return
        }
        if (action === 'measure') {
          const sessionId = optionalSessionId(u.searchParams.get('sessionId'))
          if (sessionId === null) {
            sendJson(res, 400, { ok: false, code: 'session_required', error: 'sessionId is required' })
            return
          }
          const result = await meterBridge.measure(sessionId)
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
          const result = await meterBridge.top(limit)
          if (!result.ok) {
            sendJson(res, 503, { ok: false, code: result.code })
            return
          }
          sendJson(res, 200, { ok: true, version: VERSION, ...result })
          return
        }
        if (action === 'cold') {
          const cold = await meterBridge.coldSessions()
          sendJson(res, 200, {
            ok: true,
            version: VERSION,
            pid: process.pid,
            port: ws.port,
            availability: meterBridge.availability(),
            storedAvailability: cold.availability,
            // 界面据此决定是否给已存储行渲染计量入口。宿主不提供查询服务或它的
            // Session 实现时是 'unavailable'，这一半因此不提供入口，而不是报错。
            measureAvailability: await meterBridge.coldMeasureAvailability(),
            sessions: cold.sessions
          })
          return
        }
        if (action === 'cold-measure') {
          // 按需计量已存储会话：每次把一份完整事件日志读进内存，所以由界面
          // 明确触发，并且一次一个会话。宿主不提供查询服务或 Session 实现时
          // 回答 unavailable，不把它报告成一次失败的计量。
          const ids = requestedSessionIds(u.searchParams.get('sessionIds'))
          if (ids === null) {
            sendJson(res, 400, { ok: false, code: 'session_required', error: 'sessionIds is required' })
            return
          }
          const measured = await meterBridge.coldMeasure(ids)
          if (!measured.ok) {
            sendJson(res, 503, { ok: false, code: measured.code })
            return
          }
          sendJson(res, 200, { ok: true, version: VERSION, ...measured })
          return
        }
        sendJson(res, 400, { ok: false, code: 'bad_action', error: `unknown action "${action}"` })
      } catch (e) {
        // 响应体只携带固定 code。异常消息可能带出宿主路径、服务字段或上游
        // 状态码，而这个响应会发给发起请求的一方；可读的细节只写进宿主日志，
        // 供运维查看。
        console.error('[dsh-ballast] api route failed:', String((e && e.stack) || (e && e.message) || e))
        sendJson(res, 500, { ok: false, code: 'error' })
      }
    }
  }
  const disposeRoute = ws.register(apiRoute)

  // cordis 的清理写法（与 DSH 宿主源码一致）：effect 回调返回清理函数。
  ctx.effect(() => () => {
    if (typeof disposeRoute === 'function') disposeRoute()
  })
}

apply.inject = inject

/**
 * `action=top` 每个会话显示的行数。上限防止载荷被查询串放大；下限避免
 * `limit=0` 看起来像一台空宿主而不是一次错误请求。
 */
function boundedLimit(value) {
  // Number(null) 与 Number('') 都是 0，所以缺省参数必须在转换前按默认值
  // 处理，否则会落到下限。
  if (value === null || value === undefined || value === '') return 5
  const n = Number(value)
  if (!Number.isFinite(n)) return 5
  return Math.min(20, Math.max(1, Math.trunc(n)))
}

/**
 * `action=cold-measure` 要计量的已存储会话 id 列表。
 *
 * 上限防止查询串放大成一次无界的读盘：每个 id 都要把一份完整日志读进内存，
 * 所以这里和 `boundedLimit` 一样给出上限，而不是让面板决定要读多少。空列表
 * 返回 null，与缺省参数区分开——那是缺参数，不是「什么都不测」。
 */
function requestedSessionIds(value) {
  if (typeof value !== 'string' || value === '') return null
  const ids = value.split(',').map((id) => id.trim()).filter((id) => id !== '')
  if (ids.length === 0) return null
  return ids.slice(0, COLD_MEASURE_LIMIT)
}

/** 单次请求最多计量的已存储会话数。 */
const COLD_MEASURE_LIMIT = 20

// 默认导出可调用的插件入口；具名导出 inject 供检查模块命名空间的工具使用。
export default apply
