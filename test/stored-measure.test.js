// 已存储会话的真实计量。
//
// 已存储行此前只有投影缓存里的数字，可能停在该会话最后一次写入时。这里补上
// 按需的真实计量：读完整事件日志 → `Session.create` 造游离 Session → 同一个
// `ctx.tokenMeter.measure()` → 同一个 `shapeMeasurement`，所以口径与活跃会话
// 完全一致，而不是另写一套估算。
//
// `SessionClass` 由调用方注入，与宿主服务走同一条注入路径：插件在宿主进程里
// 动态载入宿主自己装载的那一份，所以这里载入的也是同一份。测试因此跑的是宿主
// 真实的校验、真实的定价与真实的抛错，而不是本文件里的替身。

import test from 'node:test'
import assert from 'node:assert/strict'

import { createMeterBridge } from '../lib/meter.js'
import { Session as SessionClass } from '@deepseek-ai/dsh-session'

// ---- 注入围栏 ------------------------------------------------------------

// 与 meter.test.js 相同的夹具：cordis 把 inject 回调当作插件执行，回调收到派生
// 出的 scope，服务挂在 scope 上。
function makeFenceCtx(services) {
  const refuse = (name) => { throw new Error(`cannot get property "${name}" without inject`) }
  const ctx = {
    inject(names, cb) {
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
  }
  for (const name of Object.keys(services)) {
    Object.defineProperty(ctx, name, { get: () => refuse(name) })
  }
  return ctx
}

// ---- 真实的会话日志 ------------------------------------------------------

// 一份通过 core/session 校验的日志：seq 从 0 连续，surface 操作合法，助手消息
// 前面有 step/start。计量器按同样的不变量折算，所以这份夹具同时证明两件事：
// 计量读的是真实事件，而不是本文件造的数字。
const HEADER = {
  version: 4,
  id: 'stored-1',
  createdAt: 1767225600000,
  cwd: '/home/dev/app',
  parentSession: '',
  isSeeded: false
}

// 头部 id 必须与请求的会话 id 一致：core/session 会拒绝两者不同的日志，所以这里
// 按 id 生成，而不是用同一个头部回答所有会话。
const headerFor = (id) => ({ ...HEADER, id })

function storedLog() {
  return [
    { seq: 0, type: 'step/start', time: 1767225600000, data: { turn: 1, step: 1 } },
    {
      seq: 1, type: 'user/message', time: 1767225600100, surfaceOp: 'append',
      data: { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看一下这个 CI' }] }
    },
    {
      seq: 2, type: 'assistant/message', time: 1767225601000, surfaceOp: 'append',
      data: {
        turn: 1, step: 1, stream: [],
        message: {
          id: 'a1', role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          content: [{ type: 'text', text: '好的，我先看构建日志。' }]
        }
      }
    }
  ]
}

function snapshotOf(id = HEADER.id, events = storedLog(), inheritedEventCount = 0) {
  return { session: headerFor(id), inheritedEventCount, events }
}

/**
 * 一个按宿主规则给节点定价的计量器。
 *
 * 它折算真实事件：surface 追加的顺序、每个事件的 seq。它不认 `surfaceOp`，所以
 * 一份计量结果只能由真实的 `shapeMeasurement` 配上真实的事件得出。
 */
function realPricingMeter() {
  return {
    measure(session) {
      const nodes = []
      for (let seq = 0; seq < session.seq; seq += 1) {
        const event = session.eventAt(seq)
        if (event === undefined) continue
        if (event.surfaceOp !== 'append') continue
        const tokens = Math.max(1, JSON.stringify(event.data).length)
        nodes.push({ seq, tokens, heuristicTokens: tokens })
      }
      const surfaceTokens = nodes.reduce((sum, node) => sum + node.tokens, 0)
      return {
        logRevision: session.seq,
        baseline: { kind: 'estimated', tokens: surfaceTokens },
        surfaceDeltaTokens: 0,
        totalTokens: surfaceTokens,
        surfaceTokens,
        nodes
      }
    }
  }
}

/** 一个没有活跃会话、只有存储快照的宿主。 */
function storedHost({ readSession, meter = realPricingMeter(), withQuery = true } = {}) {
  const services = {
    tokenMeter: meter,
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: {
      list: async () => [{ header: HEADER, sizeBytes: 4096, eventCount: 3, revision: 3 }]
    }
  }
  if (withQuery) {
    services.sessionQuery = {
      // 真实的查询服务按请求的 id 回答，所以头部跟着 id 走。
      readSession: readSession || (async (id) => snapshotOf(id)),
      readTitleSnapshots: async () => [{ status: 'fulfilled', value: { session: HEADER, title: { title: 'stored title' } } }]
    }
  }
  return makeFenceCtx(services)
}

const bridgeFor = (ctx) => createMeterBridge(ctx, { SessionClass })

// ---- 能力判定 ------------------------------------------------------------

test('a host without the query service offers no stored metering, without an error', async () => {
  // 已存储会话的真实计量需要查询服务。跨版本没有它时这一行不出现入口，不报错。
  const bridge = bridgeFor(storedHost({ withQuery: false }))
  assert.equal(await bridge.coldMeasureAvailability(), 'unavailable')
  assert.deepEqual(await bridge.coldMeasure(['stored-1']), { ok: false, code: 'unavailable' })
  // 核心的存储列表仍然可用：计量是可选增强，不是它的前提。
  const cold = await bridge.coldSessions()
  assert.equal(cold.availability, 'available')
  assert.equal(cold.sessions.length, 1)
})

test('a host whose Session implementation cannot be loaded offers no entry either', async () => {
  // 动态 import 失败是一种宿主形状：能力判定降级为不可用，不把它报告成一次
  // 失败的计量，面板据此不渲染入口。
  const bridge = createMeterBridge(storedHost(), { SessionClass: 'not-a-class' })
  assert.equal(await bridge.coldMeasureAvailability(), 'unavailable')
  assert.deepEqual(await bridge.coldMeasure(['stored-1']), { ok: false, code: 'unavailable' })
})

test('the stored list is measured on request, not while listing', async () => {
  let reads = 0
  const ctx = storedHost({ readSession: async () => { reads += 1; return snapshotOf('stored-1') } })
  const bridge = bridgeFor(ctx)
  assert.equal(await bridge.coldMeasureAvailability(), 'available')
  // 列出会话不读日志：读盘的成本只在用户点了那一行时发生。
  await bridge.coldSessions()
  assert.equal(reads, 0, 'listing stored sessions must not read their logs')
})

// ---- 真实计量 ------------------------------------------------------------

test('a stored session is measured from its complete log', async () => {
  const bridge = bridgeFor(storedHost())
  const result = await bridge.coldMeasure(['stored-1'])
  assert.equal(result.ok, true)
  assert.equal(result.failedCount, 0)
  const [entry] = result.sessions
  const { measurement } = entry

  // 逐条归因来自完整日志：两条 surface 消息各自一行，附上事件类型与摘要。
  assert.deepEqual(measurement.rows.map((row) => row.type), ['assistant/message', 'user/message'])
  assert.equal(measurement.rows[0].preview.text, '好的，我先看构建日志。')
  assert.equal(measurement.rows[1].preview.text, '帮我看一下这个 CI')
  // 数字是折算出来的，不是缓存里那份可能过期的投影。
  assert.ok(measurement.surfaceTokens > 0)
  assert.equal(measurement.surfaceTokens, measurement.totalTokens)
})

test('the stored measurement uses the same shaping as a live session', async () => {
  // 口径一致是这一节要证明的：同一个 shapeMeasurement，同一个投影摘要转换器。
  const bridge = bridgeFor(storedHost())
  const { measurement } = (await bridge.coldMeasure(['stored-1'])).sessions[0]
  for (const field of ['logRevision', 'baseline', 'surfaceDeltaTokens', 'totalTokens',
    'surfaceTokens', 'eventCount', 'nodeCount', 'shadowPricing', 'routePricedCount',
    'unpricedCount', 'byType']) {
    assert.ok(field in measurement, `the stored measurement is missing ${field}`)
  }
  assert.ok(Array.isArray(measurement.byType.types), 'the type aggregate must be shaped too')
  // 每一行都带定位身份，与活跃会话的行同一形状。
  assert.ok(measurement.rows.every((row) => 'chat' in row))
})

test('a fork inherits the same accounting basis as a live fork', async () => {
  // 继承前缀属于父会话的对话：计量为完整日志定价，所以分叉会话会以自己的名字
  // 报告父会话的内容。分叉头部的 `isSeeded` 与继承前缀一起交给 core/session
  // 校验，所以这里给的是一份真实的分叉日志，而不是把前缀长度写成 0。
  const forkEvents = [...storedLog(), { seq: 3, type: 'session/end-seed', time: 1767225602000, data: { inherited: true } }]
  const forkHeader = { ...HEADER, id: 'stored-fork', parentSession: 'stored-1', isSeeded: true }
  const bridge = bridgeFor(storedHost({
    readSession: async () => ({ session: forkHeader, inheritedEventCount: 4, events: forkEvents })
  }))
  const result = await bridge.coldMeasure(['stored-fork'])
  assert.equal(result.ok, true)
  assert.equal(result.failedCount, 0, result.failures[0] && result.failures[0].error)
  // 分叉的 surface 仍然是它自己继承的那几行，计量为完整日志定价。
  assert.ok(result.sessions[0].measurement.surfaceTokens > 0)
})

// ---- 损坏日志 ------------------------------------------------------------

test('a corrupt log is one failed row, not a failed list', async () => {
  // core/session 校验并抛出：seq 不连续就是一份不能重放的日志。这属于那一行
  // 自己的事，与 top() 的失败行同一形状。
  const broken = [{ seq: 7, type: 'user/message', time: 1, surfaceOp: 'append',
    data: { id: 'x', role: 'user', source: { kind: 'user' }, content: [] } }]
  const bridge = bridgeFor(storedHost({ readSession: async () => snapshotOf('stored-1', broken) }))
  const result = await bridge.coldMeasure(['stored-1'])
  assert.equal(result.ok, true, 'one corrupt log must not fail the whole request')
  assert.deepEqual(result.sessions, [])
  assert.equal(result.failedCount, 1)
  assert.equal(result.failures[0].sessionId, 'stored-1')
  assert.match(result.failures[0].error, /seq/)
})

test('a log missing its header is one failed row too', async () => {
  const bridge = bridgeFor(storedHost({ readSession: async () => ({ session: null, inheritedEventCount: 0, events: [] }) }))
  const result = await bridge.coldMeasure(['stored-1'])
  assert.equal(result.ok, true)
  assert.equal(result.failedCount, 1)
  assert.match(result.failures[0].error, /header/)
})

test('a meter that throws on one log does not take the others with it', async () => {
  let call = 0
  const meter = {
    measure(session) {
      call += 1
      if (call === 1) throw new Error('surface replace range out of bounds')
      return { logRevision: session.seq, baseline: { kind: 'none', tokens: 0 }, surfaceDeltaTokens: 0, totalTokens: 0, surfaceTokens: 0, nodes: [] }
    }
  }
  const bridge = bridgeFor(storedHost({ meter }))
  const result = await bridge.coldMeasure(['stored-1', 'stored-2'])
  assert.equal(result.ok, true)
  assert.equal(result.failedCount, 1)
  assert.equal(result.sessions.length, 1)
  assert.match(result.failures[0].error, /replace range/)
})

test('a rejected read is one failed row', async () => {
  const bridge = bridgeFor(storedHost({ readSession: async () => { throw new Error('persistence offline') } }))
  const result = await bridge.coldMeasure(['stored-1'])
  assert.equal(result.ok, true)
  assert.equal(result.failedCount, 1)
  assert.match(result.failures[0].error, /offline/)
})

// ---- 限流 ----------------------------------------------------------------

test('stored logs are read one at a time, never concurrently', async () => {
  // 每次计量都把一份完整日志读进内存，并行会让这些日志同时驻留。串行让峰值
  // 保持在一次读取的量级。
  let active = 0
  let peak = 0
  const ctx = storedHost({
    readSession: async (id) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return snapshotOf(id)
    }
  })
  const bridge = bridgeFor(ctx)
  const result = await bridge.coldMeasure(['a', 'b', 'c', 'd', 'e'])
  assert.equal(result.sessions.length, 5)
  assert.equal(peak, 1, 'stored logs must not be read concurrently')
})

test('the measurement result does not retain the log it read', async () => {
  // 结果里只有整理好的行。完整日志与游离 Session 只活在那次调用的栈上，返回
  // 时就不可达——不这样，一次批量计量会把每个会话的完整日志留在宿主进程里。
  const bridge = bridgeFor(storedHost())
  const { measurement } = (await bridge.coldMeasure(['stored-1'])).sessions[0]
  assert.equal(measurement.events, undefined, 'the payload must not carry the raw log')
  assert.equal(measurement.session, undefined, 'the payload must not carry the Session object')
  // 每一行只带面板要显示的字段，没有事件的完整载荷（`stream` 是其中最大的一处）。
  for (const row of measurement.rows) {
    assert.equal(row.data, undefined, 'a row must not embed its event payload')
    assert.equal(row.stream, undefined)
  }
  assert.ok(!JSON.stringify(measurement).includes('"stream"'),
    'the shaped payload must not embed the assistant stream')
})