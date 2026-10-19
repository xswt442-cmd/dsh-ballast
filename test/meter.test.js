import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  shapeMeasurement,
  createMeterBridge,
  readProjectionOverview,
  resolveSessionTitle,
  summarizeTypes,
  workspaceBasename
} from '../lib/meter.js'

// TokenMeasurement 的形状，与宿主 token-meter 的类型定义一致
const measurement = {
  logRevision: 7,
  baseline: { kind: 'usage', tokens: 500, usage: {} },
  surfaceDeltaTokens: 120,
  totalTokens: 620,
  surfaceTokens: 620,
  nodes: [
    { seq: 0, tokens: 12, heuristicTokens: 12 },
    { seq: 3, tokens: 400, heuristicTokens: 380 },
    { seq: 1, tokens: 55, heuristicTokens: 55 }
  ]
}

// session.events 按 seq 索引（token-meter 读取 session.events[seq]）。
const session = {
  events: [
    { type: 'user/message', seq: 0, time: 1000 },
    { type: 'assistant/message', seq: 1, time: 2000 },
    { type: 'boundary', seq: 2, time: 2100 },
    { type: 'tool/result', seq: 3, time: 3000 }
  ]
}

test('shapeMeasurement carries the totals verbatim', () => {
  const out = shapeMeasurement(measurement, session)
  assert.equal(out.logRevision, 7)
  assert.equal(out.totalTokens, 620)
  assert.equal(out.surfaceTokens, 620)
  assert.equal(out.surfaceDeltaTokens, 120)
  assert.equal(out.baseline.kind, 'usage')
  assert.equal(out.nodeCount, 3)
  assert.equal(out.eventCount, 4)
})

test('rows are sorted heaviest-first (the ballast to drop)', () => {
  const out = shapeMeasurement(measurement, session)
  assert.deepEqual(out.rows.map((r) => r.seq), [3, 1, 0])
  assert.deepEqual(out.rows.map((r) => r.tokens), [400, 55, 12])
})

test('rows join seq back to the durable event type', () => {
  const out = shapeMeasurement(measurement, session)
  assert.equal(out.rows[0].type, 'tool/result')
  assert.equal(out.rows[1].type, 'assistant/message')
  assert.equal(out.rows[2].type, 'user/message')
})

test('the meter never calls a deprecated synchronous session reader', () => {
  // core/session 把 eventAt / snapshotEvents / ownEvents 标记为 @deprecated，
  // 并禁止新调用。拒绝这三者的会话对象是这条规则唯一诚实的夹具，它还必须
  // 回答面板的所有问题。
  const events = [
    { type: 'session/title', seq: 0, data: { title: 'RC1 title' } },
    { type: 'user/message', seq: 1, time: '2026-09-04T01:00:00.000Z', data: { text: 'hello' } },
    { type: 'tool/result', seq: 2, time: '2026-09-04T01:00:01.000Z', data: { text: 'done' } }
  ]
  const refuse = () => { throw new Error('deprecated synchronous session read') }
  const rc1Session = {
    id: 'session-rc1',
    header: { cwd: '/work/fallback' },
    get seq() { return events.length },
    get inheritedEventCount() { return 0 },
    eventAt: refuse,
    snapshotEvents: refuse,
    ownEvents: refuse
  }

  assert.deepEqual(resolveSessionTitle({ ...rc1Session, events }), { title: 'RC1 title', titleSource: 'title' })
  const out = shapeMeasurement({
    ...measurement,
    nodes: [{ seq: 1, tokens: 12, heuristicTokens: 12 }, { seq: 2, tokens: 20, heuristicTokens: 20 }]
  }, rc1Session, { events, inheritedEventCount: 0 })
  assert.equal(out.eventCount, 3, 'the log length comes from session.seq, not a reader')
  assert.deepEqual(out.rows.map((row) => row.type), ['tool/result', 'user/message'])
})

test('lib/meter.js names no deprecated session reader', () => {
  // 上面的夹具证明了测试覆盖的路径；这里证明它没有覆盖的路径。先去掉注释，
  // 避免头部的弃用说明满足自己的禁令。
  const source = readFileSync(new URL('../lib/meter.js', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  for (const name of ['.eventAt(', '.snapshotEvents(', '.ownEvents(']) {
    assert.equal(code.includes(name), false, `lib/meter.js must not call ${name}`)
  }
})

test('rows tolerate missing events (seq beyond the log)', () => {
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 99, tokens: 5, heuristicTokens: 5 }] },
    session
  )
  assert.equal(out.rows[0].type, null)
  assert.equal(out.rows[0].time, null)
})

// dsh <= 0.1.1-rc.2 完全不发送 heuristicTokens。把缺失字段强制成 0 会让
// 每一行都报告 routePriced 且 priceDelta === tokens，那是一整列捏造的信号。
test('a host without the shadow price reports nulls, never delta === tokens', () => {
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 0, tokens: 12 }, { seq: 3, tokens: 400 }] },
    session
  )
  assert.deepEqual(out.rows.map((r) => r.heuristicTokens), [null, null])
  assert.deepEqual(out.rows.map((r) => r.priceDelta), [null, null])
  assert.deepEqual(out.rows.map((r) => r.routePriced), [null, null])
  assert.equal(out.routePricedCount, 0)
  assert.equal(out.shadowPricing, 'absent')
})

test('a mix of priced and unpriced nodes is partial, not available', () => {
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 0, tokens: 12, heuristicTokens: 12 }, { seq: 3, tokens: 400 }] },
    session
  )
  assert.equal(out.shadowPricing, 'partial')
  assert.equal(out.routePricedCount, 0)
})

test('an empty surface cannot tell the two hosts apart', () => {
  const out = shapeMeasurement({ ...measurement, nodes: [] }, session)
  assert.equal(out.shadowPricing, 'unknown')
  assert.equal(out.nodeCount, 0)
})

test('a host that prices every node is marked available', () => {
  assert.equal(shapeMeasurement(measurement, session).shadowPricing, 'available')
})

// ---- 注入围栏 -----------------------------------------------------------
// 普通 mock 抓不到这类缺陷，而不准确的 mock 比没有更糟：cordis 把
// `inject(names, cb)` 当作 `plugin({ inject: names, apply: cb })` 执行，
// 所以 cb 收到派生出的 *scope*（服务通过 `scope.<name>` 读取），不是按位置
// 展开的服务。按位置写成的桥在真实宿主上读到 undefined，而所有单元测试仍然
// 通过。
function makeFenceCtx(services, { defer = false } = {}) {
  const pending = []
  const refuse = (name) => {
    throw new Error(`cannot get property "${name}" without inject`)
  }
  /** 交给回调一个只能读取被注入名字的 scope。 */
  const runFence = ([names, cb]) => {
    const scope = Object.create(null)
    for (const name of names) {
      Object.defineProperty(scope, name, { get: () => services[name], enumerable: true })
    }
    for (const name of Object.keys(services)) {
      if (names.includes(name)) continue
      Object.defineProperty(scope, name, { get: () => refuse(name) })
    }
    cb(scope, undefined)
  }
  const ctx = {
    inject(names, cb) {
      if (defer) { pending.push([names, cb]); return }
      runFence([names, cb])
    },
    /** 释放一个延迟的 inject。 */
    provide() {
      runFence(pending.shift())
    }
  }
  for (const name of Object.keys(services)) {
    Object.defineProperty(ctx, name, { get: () => refuse(name) })
  }
  return ctx
}

const liveSession = {
  id: 'session-1',
  header: { cwd: 'E:\\.codes\\demo-project' },
  events: [
    {
      type: 'user/message', seq: 0, time: 1000, surfaceOp: 'append',
      data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我修一下 CI' }] }
    },
    { type: 'tool/call', seq: 1, time: 1100, data: { callId: 'c1', name: 'bash' } },
    {
      type: 'tool/result', seq: 2, time: 1200, surfaceOp: 'append',
      data: { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'exit 0' }] }] } }
    }
  ]
}

// 一个日志带有 `session/title` 事件的会话，两种标题答案因此不同：日志说
// 'log title'，cwd 目录名会说 'demo-project'。两者一致的夹具区分不了这两条
// 路径。
const titledSession = {
  ...liveSession,
  events: [
    ...liveSession.events,
    { type: 'session/title', seq: 3, time: 1300, data: { title: 'log title' } }
  ]
}

const fenceServices = {
  tokenMeter: { measure: () => measurement },
  sessions: {
    list: () => [liveSession],
    get: (id) => (id === liveSession.id ? liveSession : undefined)
  }
}

test('the bridge binds services inside the inject fence, never at apply time', async () => {
  const meterCalls = []
  const ctx = makeFenceCtx({
    tokenMeter: { measure: (session) => { meterCalls.push(session.id); return measurement } },
    sessions: fenceServices.sessions
  })
  const bridge = createMeterBridge(ctx)
  assert.equal(bridge.availability(), 'available')
  assert.deepEqual(meterCalls, [], 'constructing the bridge must not price anything')
  assert.equal((await bridge.measure('session-1')).ok, true)
  assert.deepEqual(meterCalls, ['session-1'])
})

test('a tokenMeter without measure() leaves the bridge unavailable, not lying', async () => {
  // 绑定时检查形状：availability() 必须描述桥真正能做的事。缺少 measure()
  // 的服务对象否则会读成 'available'，然后每个请求都以 measure_failed 失败。
  const bridge = createMeterBridge(makeFenceCtx({
    tokenMeter: { price: () => measurement },
    sessions: fenceServices.sessions
  }))
  assert.equal(bridge.availability(), 'unavailable')
  assert.deepEqual(await bridge.measure('session-1'), { ok: false, code: 'unavailable' })
  assert.deepEqual(await bridge.listSessions(), [])
})

test('a malformed measurement is one failed session, not an escaped throw', async () => {
  // shapeMeasurement 读取 measurement.nodes。计量服务仍返回、但缺少节点列表
  // 的结果必须与损坏日志进入同一类失败：measure() 回答 measure_failed，
  // top() 记录一次失败，而不是让异常逃逸成 500（见 README 安全模型）。
  const malformed = { ...measurement, nodes: undefined }
  const bridge = createMeterBridge(makeFenceCtx({
    tokenMeter: { measure: () => malformed },
    sessions: fenceServices.sessions
  }))
  assert.equal((await bridge.measure('session-1')).code, 'measure_failed')
  const top = await bridge.top(5)
  assert.equal(top.ok, true, 'one bad session must not fail the whole host view')
  assert.deepEqual(top.sessions, [])
  assert.equal(top.failedCount, 1)
})

test('reading a service off ctx outside the fence is exactly what the harness forbids', () => {
  const ctx = makeFenceCtx(fenceServices)
  assert.throws(() => ctx.tokenMeter, /without inject/)
  assert.throws(() => ctx.sessions, /without inject/)
})

test('a scope without the services degrades to unavailable instead of throwing', async () => {
  // 围栏主体收到一个 scope 对象；按位置绑定服务的桥会为所有服务得到
  // undefined。未绑定的服务不能把只读路由变成 500。
  const bridge = createMeterBridge({ inject: (names, cb) => cb(Object.create(null)) })
  assert.equal(bridge.availability(), 'unavailable')
  assert.deepEqual(await bridge.listSessions(), [])
  assert.deepEqual(await bridge.measure('session-1'), { ok: false, code: 'unavailable' })
})

test('availability stays unavailable until the injected services arrive', async () => {
  const ctx = makeFenceCtx(fenceServices, { defer: true })
  const bridge = createMeterBridge(ctx)
  assert.equal(bridge.availability(), 'unavailable')
  assert.deepEqual(await bridge.listSessions(), [])
  assert.deepEqual(await bridge.measure('session-1'), { ok: false, code: 'unavailable' })
  ctx.provide()
  assert.equal(bridge.availability(), 'available')
  assert.equal((await bridge.measure('session-1')).ok, true)
})

test('a session the store does not know is an honest no_live_session', async () => {
  const ctx = makeFenceCtx({ tokenMeter: { measure: () => measurement }, sessions: { list: () => [], get: () => undefined } })
  assert.deepEqual(await createMeterBridge(ctx).measure('gone'), { ok: false, code: 'no_live_session' })
})

test('a measure() that throws on a corrupt log fails one session, not the route', async () => {
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => { throw new Error('surface replace range out of bounds') } },
    sessions: fenceServices.sessions
  })
  const result = await createMeterBridge(ctx).measure('session-1')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'measure_failed')
  assert.match(result.error, /replace range/)
})

test('the measure payload carries the display title next to the measurement', async () => {
  const ctx = makeFenceCtx(fenceServices)
  const result = await createMeterBridge(ctx).measure('session-1')
  assert.equal(result.title, 'demo-project')
  assert.equal(result.titleSource, 'cwd')
})

test('a title the query answers with is preferred over the cwd fallback', async () => {
  // 持久化标题在日志里，ctx.sessionQuery 是读取它的唯一受支持方式；cwd
  // 目录名只是从未携带 session/title 事件的会话的回退。
  // 使用新的会话对象：`derived` 按对象身份缓存，其他测试已经在这个日志
  // 长度上回答过 liveSession。
  const titled = { ...liveSession }
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => measurement },
    sessions: { list: () => [titled], get: (id) => (id === titled.id ? titled : undefined) },
    sessionQuery: {
      readSession: async () => null,
      readTitleSnapshots: (ids) => ids.map((id) => ({
        status: 'fulfilled',
        value: { session: { id }, title: { title: 'queried title', messageSeqs: [], source: 'model', eventSeq: 3, updatedAt: 1 } }
      }))
    }
  })
  const bridge = createMeterBridge(ctx)
  const result = await bridge.measure('session-1')
  assert.equal(result.title, 'queried title')
  assert.equal(result.titleSource, 'title')
  const list = await bridge.listSessions()
  assert.equal(list[0].title, 'queried title')
})

test('a rejected title read leaves the title in the log this process holds', async () => {
  // 批量读取没有为任何一行作答，所以不能用 cwd 目录名占据标题槽：本进程
  // 已持有的日志能命名这个会话，否则面板会在本进程余下的时间里失去该标题。
  const rejected = { ...titledSession }
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => measurement },
    sessions: { list: () => [rejected], get: (id) => (id === rejected.id ? rejected : undefined) },
    sessionQuery: {
      readSession: async () => null,
      readTitleSnapshots: () => [{ status: 'rejected', reason: new Error('search disabled') }]
    }
  })
  const bridge = createMeterBridge(ctx)
  const result = await bridge.measure('session-1')
  assert.equal(result.title, 'log title')
  assert.equal(result.titleSource, 'title')
  // 第二次刷新必须给出同样的答案，而不是缓存下来的回退值。
  assert.equal((await bridge.listSessions())[0].title, 'log title')
})

test('a title read that throws leaves the title in the log this process holds', async () => {
  const failing = { ...titledSession }
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => measurement },
    sessions: { list: () => [failing], get: (id) => (id === failing.id ? failing : undefined) },
    sessionQuery: {
      readSession: async () => null,
      readTitleSnapshots: () => { throw new Error('query service down') }
    }
  })
  const bridge = createMeterBridge(ctx)
  const result = await bridge.measure('session-1')
  assert.equal(result.title, 'log title')
  assert.equal(result.titleSource, 'title')
})

test('the bridge exposes optional RC1 projection values without mixing their accounting bases', async () => {
  const projectionValues = {
    tokenUsage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 40 },
    contextPressure: { pressureTokens: 400, projectedTokens: 455, contextWindow: 128000 },
    contextBreakdown: { systemTokens: 10, toolsTokens: 50, messageTokens: 320 }
  }
  const ctx = makeFenceCtx({
    ...fenceServices,
    sessionProjections: {
      snapshot(target) {
        assert.equal(target, liveSession)
        return { values: projectionValues }
      }
    }
  })
  const result = await createMeterBridge(ctx).measure('session-1')
  assert.deepEqual(result.projections, projectionValues)
})

test('missing or malformed optional projections degrade to null', () => {
  assert.equal(readProjectionOverview(null, liveSession), null)
  assert.equal(readProjectionOverview({ snapshot: () => { throw new Error('not mounted') } }, liveSession), null)
  assert.deepEqual(
    readProjectionOverview({ snapshot: () => ({
      values: {
        tokenUsage: { uncachedInputTokens: -1 },
        contextPressure: { contextWindow: 0, projectedTokens: 12 },
        contextBreakdown: { systemTokens: 1, toolsTokens: '2', messageTokens: 3 }
      }
    }) }, liveSession),
    { tokenUsage: null, contextPressure: { projectedTokens: 12 }, contextBreakdown: null }
  )
})

test('listSessions is heaviest-first and carries a display title', async () => {
  const small = { id: 'tiny', header: {}, events: [{ type: 'user/message', seq: 0 }] }
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => measurement },
    sessions: { list: () => [small, liveSession], get: () => undefined }
  })
  assert.deepEqual(await createMeterBridge(ctx).listSessions(), [
    { sessionId: 'session-1', eventCount: 3, ownEventCount: null, inheritedEventCount: null, title: 'demo-project', titleSource: 'cwd' },
    { sessionId: 'tiny', eventCount: 1, ownEventCount: null, inheritedEventCount: null, title: 'tiny', titleSource: 'id' }
  ])
})

test('listSessions tolerates a session whose event log is not initialized yet', async () => {
  const pending = { id: 'pending', header: {} }
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => measurement },
    sessions: { list: () => [pending], get: () => pending }
  })
  assert.deepEqual(await createMeterBridge(ctx).listSessions(), [
    { sessionId: 'pending', eventCount: 0, ownEventCount: null, inheritedEventCount: null, title: 'pending', titleSource: 'id' }
  ])
})

test('shapeMeasurement tolerates an uninitialized event log', () => {
  const out = shapeMeasurement({ ...measurement, nodes: [] }, { id: 'pending' })
  assert.equal(out.eventCount, 0)
  assert.deepEqual(out.rows, [])
})

// ---- 行字段 ------------------------------------------------------------
test('rows expose the route-vs-heuristic spread', () => {
  const out = shapeMeasurement({
    ...measurement,
    nodes: [
      { seq: 0, tokens: 12, heuristicTokens: 12 },
      { seq: 3, tokens: 400, heuristicTokens: 361 }
    ]
  }, session)
  assert.deepEqual(out.rows.map((r) => r.priceDelta), [39, 0])
  assert.deepEqual(out.rows.map((r) => r.routePriced), [true, false])
  assert.equal(out.routePricedCount, 1)
})

test('rows carry a preview and the surfaceOp kind', () => {
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 2, tokens: 90, heuristicTokens: 90 }] },
    { events: liveSession.events }
  )
  const toolRow = out.rows[0]
  assert.equal(toolRow.type, 'tool/result')
  assert.equal(toolRow.surfaceOp, 'append')
  assert.equal(toolRow.preview.text, '[bash] exit 0')
})

test('a compaction replace is distinguishable from an append', () => {
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 0, tokens: 5, heuristicTokens: 5 }] },
    { events: [{ type: 'user/message', seq: 0, time: 1, surfaceOp: { op: 'replace', start: 0, end: 4 }, data: { content: [] } }] }
  )
  assert.equal(out.rows[0].surfaceOp, 'replace')
})

// ---- 标题 --------------------------------------------------------------
test('the last durable session/title event wins', () => {
  const titled = {
    id: 'session-9',
    header: { cwd: '/home/dev/another-app' },
    events: [
      { type: 'session/title', seq: 4, data: { title: '第一版标题' } },
      { type: 'user/message', seq: 5 },
      { type: 'session/title', seq: 6, data: { title: '重命名后的标题' } }
    ]
  }
  assert.deepEqual(resolveSessionTitle(titled), { title: '重命名后的标题', titleSource: 'title' })
})

test('a blank or missing title falls through to the workspace, then the id', () => {
  assert.deepEqual(
    resolveSessionTitle({ id: 's', header: { cwd: '/home/dev/another-app' }, events: [{ type: 'session/title', data: { title: '   ' } }] }),
    { title: 'another-app', titleSource: 'cwd' }
  )
  assert.deepEqual(resolveSessionTitle({ id: 's', header: {}, events: [] }), { title: 's', titleSource: 'id' })
  assert.deepEqual(resolveSessionTitle(undefined), { title: '', titleSource: 'id' })
})

test('workspaceBasename handles both separators and refuses to label a root', () => {
  assert.equal(workspaceBasename('E:\\.codes\\createhelper\\dsh-ballast'), 'dsh-ballast')
  assert.equal(workspaceBasename('E:\\.codes\\createhelper\\dsh-ballast\\'), 'dsh-ballast')
  assert.equal(workspaceBasename('/home/dev/project'), 'project')
  assert.equal(workspaceBasename('/'), '')
  assert.equal(workspaceBasename('C:\\'), '')
  assert.equal(workspaceBasename(undefined), '')
})

// ---- 派生缓存 ----------------------------------------------------------
test('a title scan is skipped at an unchanged log revision and redone when it grows', () => {
  const events = [
    { type: 'session/title', seq: 0, data: { title: 'qa' } },
    { type: 'user/message', seq: 1 }
  ]
  let indexReads = 0
  const counted = new Proxy(events, {
    get(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) indexReads += 1
      return target[prop]
    }
  })
  const session = { id: 'session-memo', header: { cwd: '/home/dev/app' }, events: counted }

  assert.deepEqual(resolveSessionTitle(session), { title: 'qa', titleSource: 'title' })
  const afterFirst = indexReads
  assert.ok(afterFirst > 0, 'the first call has to walk the log')

  assert.deepEqual(resolveSessionTitle(session), { title: 'qa', titleSource: 'title' })
  assert.equal(indexReads, afterFirst, 'the same revision must not rescan the log')

  events.push({ type: 'user/message', seq: 2 })
  resolveSessionTitle(session)
  assert.ok(indexReads > afterFirst, 'a longer log is a new revision and must rescan')
})

// ---- 按类型聚合 --------------------------------------------------------
test('the aggregate carries the same absence rule as the rows', () => {
  const out = summarizeTypes([
    { type: 'tool/result', tokens: 400 },
    { type: 'tool/result', tokens: 100 },
    { type: 'user/message', tokens: 100 },
    { type: null, tokens: null }
  ])
  assert.equal(out.total, 600)
  assert.deepEqual(out.types.map((group) => group.type), ['tool/result', 'user/message', null])
  assert.equal(out.types[0].count, 2)
  assert.ok(Math.abs(out.types[0].share - 500 / 600) < 1e-9)
  // 一个未计价的行仍计入该类型的行数，但对 token 没有贡献，因此没有占比。
  assert.equal(out.types[2].count, 1)
  assert.equal(out.types[2].tokens, 0)
  assert.equal(out.types[2].share, 0)
})

test('an empty aggregate reports nothing instead of dividing by zero', () => {
  assert.deepEqual(summarizeTypes([]), { total: 0, types: [] })
})

test('two derivations over one session do not overwrite each other', () => {
  // 每个会话只有一个缓存槽位时，取工具名映射会拿到缓存的标题，静默丢掉
  // `[bash]` 前缀。
  const session = { id: 'session-memo', header: { cwd: '/home/dev/app' }, events: liveSession.events }
  assert.ok(resolveSessionTitle(session).title)
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 2, tokens: 90, heuristicTokens: 90 }] },
    session
  )
  assert.equal(out.rows[0].preview.text, '[bash] exit 0')
})
