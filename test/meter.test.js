import test from 'node:test'
import assert from 'node:assert/strict'
import { shapeMeasurement, createMeterBridge, resolveSessionTitle, summarizeTypes, workspaceBasename } from '../lib/meter.js'

// TokenMeasurement shape per deepseek-harness packages/llm/token-meter/src/types.ts
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

// session.events is indexed by seq (token-meter reads session.events[seq]).
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

test('rows tolerate missing events (seq beyond the log)', () => {
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 99, tokens: 5, heuristicTokens: 5 }] },
    session
  )
  assert.equal(out.rows[0].type, null)
  assert.equal(out.rows[0].time, null)
})

// dsh <= 0.1.1-rc.2 emits no heuristicTokens at all. Proven on a live host:
// coercing the missing field to 0 made every one of 922 rows report
// routePriced with priceDelta === tokens — a column of pure fabrication.
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

// ---- injection fence ---------------------------------------------------
// A plain mock cannot catch this class of bug, and an *inaccurate* mock is
// worse than none: cordis runs `inject(names, cb)` as
// `plugin({ inject: names, apply: cb })`, so cb receives the derived *scope*
// (services are read as `scope.<name>`), not the services spread positionally.
// A bridge written the positional way reads `undefined` against a live host
// while every unit test stays green.
function makeFenceCtx(services, { defer = false } = {}) {
  const pending = []
  const refuse = (name) => {
    throw new Error(`cannot get property "${name}" without inject`)
  }
  /** Hand the callback a scope with exactly the injected names readable. */
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
    /** Release a deferred inject. */
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

const fenceServices = {
  tokenMeter: { measure: () => measurement },
  sessions: {
    list: () => [liveSession],
    get: (id) => (id === liveSession.id ? liveSession : undefined)
  }
}

test('the bridge binds services inside the inject fence, never at apply time', () => {
  const meterCalls = []
  const ctx = makeFenceCtx({
    tokenMeter: { measure: (session) => { meterCalls.push(session.id); return measurement } },
    sessions: fenceServices.sessions
  })
  const bridge = createMeterBridge(ctx)
  assert.equal(bridge.availability(), 'available')
  assert.deepEqual(meterCalls, [], 'constructing the bridge must not price anything')
  assert.equal(bridge.measure('session-1').ok, true)
  assert.deepEqual(meterCalls, ['session-1'])
})

test('reading a service off ctx outside the fence is exactly what the harness forbids', () => {
  const ctx = makeFenceCtx(fenceServices)
  assert.throws(() => ctx.tokenMeter, /without inject/)
  assert.throws(() => ctx.sessions, /without inject/)
})

test('a scope without the services degrades to unavailable instead of throwing', () => {
  // Found in browser QA: the fence body receives one scope object, and a bridge
  // that binds services positionally gets `undefined` for all of them. Whatever
  // the cause, an unbound service must not turn a read-only route into a 500.
  const bridge = createMeterBridge({ inject: (names, cb) => cb(Object.create(null)) })
  assert.equal(bridge.availability(), 'unavailable')
  assert.deepEqual(bridge.listSessions(), [])
  assert.deepEqual(bridge.measure('session-1'), { ok: false, code: 'unavailable' })
})

test('availability stays unavailable until the injected services arrive', () => {
  const ctx = makeFenceCtx(fenceServices, { defer: true })
  const bridge = createMeterBridge(ctx)
  assert.equal(bridge.availability(), 'unavailable')
  assert.deepEqual(bridge.listSessions(), [])
  assert.deepEqual(bridge.measure('session-1'), { ok: false, code: 'unavailable' })
  ctx.provide()
  assert.equal(bridge.availability(), 'available')
  assert.equal(bridge.measure('session-1').ok, true)
})

test('a session the store does not know is an honest no_live_session', () => {
  const ctx = makeFenceCtx({ tokenMeter: { measure: () => measurement }, sessions: { list: () => [], get: () => undefined } })
  assert.deepEqual(createMeterBridge(ctx).measure('gone'), { ok: false, code: 'no_live_session' })
})

test('a measure() that throws on a corrupt log fails one session, not the route', () => {
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => { throw new Error('surface replace range out of bounds') } },
    sessions: fenceServices.sessions
  })
  const result = createMeterBridge(ctx).measure('session-1')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'measure_failed')
  assert.match(result.error, /replace range/)
})

test('the measure payload carries the display title next to the measurement', () => {
  const ctx = makeFenceCtx(fenceServices)
  const result = createMeterBridge(ctx).measure('session-1')
  assert.equal(result.title, 'demo-project')
  assert.equal(result.titleSource, 'cwd')
})

test('listSessions is heaviest-first and carries a display title', () => {
  const small = { id: 'tiny', header: {}, events: [{ type: 'user/message', seq: 0 }] }
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => measurement },
    sessions: { list: () => [small, liveSession], get: () => undefined }
  })
  assert.deepEqual(createMeterBridge(ctx).listSessions(), [
    { sessionId: 'session-1', eventCount: 3, title: 'demo-project', titleSource: 'cwd' },
    { sessionId: 'tiny', eventCount: 1, title: 'tiny', titleSource: 'id' }
  ])
})

test('listSessions tolerates a session whose event log is not initialized yet', () => {
  const pending = { id: 'pending', header: {} }
  const ctx = makeFenceCtx({
    tokenMeter: { measure: () => measurement },
    sessions: { list: () => [pending], get: () => pending }
  })
  assert.deepEqual(createMeterBridge(ctx).listSessions(), [
    { sessionId: 'pending', eventCount: 0, title: 'pending', titleSource: 'id' }
  ])
})

test('shapeMeasurement tolerates an uninitialized event log', () => {
  const out = shapeMeasurement({ ...measurement, nodes: [] }, { id: 'pending' })
  assert.equal(out.eventCount, 0)
  assert.deepEqual(out.rows, [])
})

// ---- M1 row columns ----------------------------------------------------
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

// ---- titles ------------------------------------------------------------
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

// ---- derived cache -------------------------------------------------------
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

// ---- per-type aggregate --------------------------------------------------
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
  // An unpriced row still counts towards how many rows a type holds, but
  // contributes nothing to its tokens and therefore no share.
  assert.equal(out.types[2].count, 1)
  assert.equal(out.types[2].tokens, 0)
  assert.equal(out.types[2].share, 0)
})

test('an empty aggregate reports nothing instead of dividing by zero', () => {
  assert.deepEqual(summarizeTypes([]), { total: 0, types: [] })
})

test('two derivations over one session do not overwrite each other', () => {
  // One memo slot per session used to return the cached title where the
  // tool-name map was expected, which silently loses the `[bash]` prefix.
  const session = { id: 'session-memo', header: { cwd: '/home/dev/app' }, events: liveSession.events }
  assert.ok(resolveSessionTitle(session).title)
  const out = shapeMeasurement(
    { ...measurement, nodes: [{ seq: 2, tokens: 90, heuristicTokens: 90 }] },
    session
  )
  assert.equal(out.rows[0].preview.text, '[bash] exit 0')
})
