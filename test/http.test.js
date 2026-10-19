import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import apply from '../lib/index.js'

// CI 的启动检查针对没有 provider 路由的 `dsh web`，它的计量 surface 节点
// 恒为 0，那里所有逐行断言都是空转。这些测试把真实宿主端放在真实 socket
// 与真实行后面，所以守卫和行约定是对流量断言，不是对形状断言。

const SURFACE = {
  logRevision: 4,
  baseline: { kind: 'empty', tokens: 0 },
  surfaceDeltaTokens: 455,
  totalTokens: 455,
  surfaceTokens: 455,
  nodes: [
    { seq: 0, tokens: 15, heuristicTokens: 15 },
    { seq: 1, tokens: 40, heuristicTokens: 55 },
    { seq: 2, tokens: 400, heuristicTokens: 369 }
  ]
}

const EVENTS = [
  { seq: 0, type: 'user/message', time: 1000, data: { text: '看一下窗口占用' } },
  { seq: 1, type: 'assistant/message', time: 2000, data: { text: '好的' } },
  { seq: 2, type: 'tool/result', time: 3000, data: { toolName: 'read', content: 'x'.repeat(400) } }
]

function fakeSession() {
  return {
    id: 'sess-http-1',
    events: EVENTS,
    header: { cwd: 'E:/.codes/createhelper/dsh-ballast' }
  }
}

// 一个日志无法计量的会话：一个损坏日志不能掩盖宿主上的其余会话，而这一点
// 只有跨会话扫描可能弄错。
function brokenSession() {
  return { id: 'sess-broken', events: [{ seq: 0, type: 'user/message', time: 1, data: {} }], header: { cwd: '/tmp/broken' } }
}

/**
 * 在真实 loopback 服务器上挂载宿主端。
 * @param nodes - ctx.tokenMeter.measure 为活跃会话报告的内容。传入
 *   pre-0.1.2-alpha.2 形状的节点（没有 heuristicTokens）来验证降级宿主。
 */
async function mount(nodes, { connection, extra } = {}) {
  const session = fakeSession()
  const broken = brokenSession()
  const routes = new Map()
  const disposed = []
  // connection scope 自己的销毁：触发它，测试就能到达服务重载后的状态——
  // `connection` 又是 null，但宿主已经有过一个。
  const scopeDisposed = []
  const ctx = {
    webServer: {
      port: 0,
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      }
    },
    inject(_names, cb) {
      cb({
        connection,
        on(event, fn) {
          if (event === 'dispose') scopeDisposed.push(fn)
        },
        tokenMeter: {
          measure(target) {
            if (target === broken) throw new Error('step event seq mismatch')
            if (target !== session) throw new Error('measure on an unknown session')
            return { ...SURFACE, nodes }
          }
        },
        sessions: {
          list: () => [session, broken],
          get: (id) => (id === session.id ? session : id === broken.id ? broken : null)
        },
        // 可选服务，只在需要它们的测试里出现：一个都没挂载的宿主，是活跃
        // 部分必须继续工作的状态。
        ...extra
      })
    },
    on(event, fn) {
      if (event === 'dispose') disposed.push(fn)
    },
    // cordis 的销毁写法：effect 回调返回清理函数（宿主端这样注册清理）。
    effect(fn) {
      const cleanup = fn()
      const list = Array.isArray(cleanup) ? cleanup : [cleanup]
      for (const fn2 of list) if (typeof fn2 === 'function') disposed.push(fn2)
    }
  }
  apply(ctx)

  const server = createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://x').pathname
    const route = routes.get(path)
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not mounted')
      return
    }
    void route.handler(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  // 与 DSH 的 webServer 端口保持一致，让 Origin 校验走真实端口。
  ctx.webServer.port = port
  return {
    port,
    url: (query = '') => `http://127.0.0.1:${port}/dsh-ballast/api${query}`,
    // 路由对象本身，用于真实 socket 无法构造的一个场景：peer 不在这台机器上。
    route: () => routes.get('/dsh-ballast/api'),
    // 模拟服务像重载一样消失，留下“这个宿主曾经有过 Connection”的闩锁。
    unloadConnection: async () => {
      for (const fn of scopeDisposed) await fn()
    },
    dispose: async () => {
      for (const fn of disposed) await fn()
      server.close()
      await once(server, 'close')
    }
  }
}

test('RC1 Connection rejection is final and never falls back to the legacy guard', async (t) => {
  const host = await mount(SURFACE.nodes, {
    connection: { requestRejection: () => 401 }
  })
  t.after(() => host.dispose())

  const res = await send(host.url('?action=sessions'))
  assert.equal(res.status, 401)
  assert.equal(res.body.code, 'unauthorized')
})

test('a Connection that cannot answer is treated as unavailable, not as permission', async (t) => {
  const host = await mount(SURFACE.nodes, {
    connection: { requestRejection: () => { throw new Error('connection service gone') } }
  })
  t.after(() => host.dispose())

  // 一个抛出异常的 connection 服务让请求保持未授权：闸门自己回答 503，
  // 路由处理函数永远不会被到达。
  const res = await send(host.url('?action=sessions'))
  assert.equal(res.status, 503)
  assert.equal(res.body.code, 'connection_unavailable')
})

test('a Connection that returns no rejection admits the request and the route answers 200', async (t) => {
  let calls = 0
  const host = await mount(SURFACE.nodes, {
    connection: { requestRejection: () => { calls += 1; return undefined } }
  })
  t.after(() => host.dispose())

  const res = await send(host.url('?action=sessions'), { origin: 'https://trusted.example' })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(calls, 1)
})

test('a Connection rejection that is not 401 reads as forbidden', async (t) => {
  const host = await mount(SURFACE.nodes, {
    connection: { requestRejection: () => 403 }
  })
  t.after(() => host.dispose())

  const res = await send(host.url('?action=sessions'))
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'forbidden')
})

// 重载间隙是更弱的围栏绝不能填补的场景。宿主一旦有过 RC1 Connection，
// Connection 就是边界，所以服务卸载期间到达的请求回答 503——落到 loopback
// 守卫会向一个浏览器提供会话，而该浏览器的认证正是重载丢掉的东西。
test('a Connection reload gap answers 503 and never reaches the loopback guard', async (t) => {
  const host = await mount(SURFACE.nodes, {
    connection: { requestRejection: () => undefined }
  })
  t.after(() => host.dispose())

  assert.equal((await send(host.url('?action=sessions'))).status, 200)

  await host.unloadConnection()
  // 下面的 Origin 是守卫会以 403 拒绝的一个。读到 503 证明守卫从未被查询，
  // 而不只是路由仍然关闭。
  const gap = await send(host.url('?action=sessions'), { origin: 'https://evil.example' })
  assert.equal(gap.status, 503)
  assert.equal(gap.body.code, 'connection_unavailable')
  for (const field of ['sessions', 'measurement', 'availability', 'pid']) {
    assert.ok(!(field in gap.body), `the gap reply leaks ${field}`)
  }
})

// 路由的外层围栏是宿主抛出与浏览器之间的最后一道。它回答一个固定 code，
// 无法归类的消息只进日志：异常文本可能带出路径、服务字段或上游状态码。
test('an unexpected failure answers a fixed code and logs the message', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  const chunks = []
  let status = null
  const res = {
    writeHead(code) { status = code },
    setHeader() {},
    end(text) { if (text) chunks.push(text) }
  }
  const logged = []
  const originalError = console.error
  console.error = (...args) => logged.push(args.join(' '))
  try {
    // 在守卫与方法闸门之后，给 URL 解析器一个无法读取的请求行——响应只携带
    // 固定 `code`，绝不带解析器的消息。
    await host.route().handler({
      method: 'GET',
      url: 'http://[',
      headers: { host: `127.0.0.1:${host.port}` },
      socket: { remoteAddress: '127.0.0.1' }
    }, res)
  } finally {
    console.error = originalError
  }

  assert.equal(status, 500)
  const body = JSON.parse(chunks.join(''))
  assert.equal(body.ok, false)
  assert.equal(body.code, 'error')
  assert.ok(!('error' in body), 'the reply carries an error field')
  assert.ok(!/invalid url|TypeError/i.test(JSON.stringify(body)), 'the reply leaks the exception text')
  assert.ok(logged.some((line) => /invalid url|TypeError/i.test(line)), 'the message never reached the log')
})

/** 原始请求，便于覆盖 Host——fetch() 会把它规范化掉。 */
function send(url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = request(
      {
        host: '127.0.0.1',
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers: { host: `127.0.0.1:${target.port}`, ...headers }
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

test('the guard rejects cross-site, foreign origin and rebound host, admits loopback', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  assert.equal((await send(host.url('?action=sessions'), { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await send(host.url('?action=sessions'), { origin: 'https://evil.example' })).status, 403)
  assert.equal((await send(host.url('?action=sessions'), { host: 'rebound.example' })).status, 403)
  assert.equal((await send(host.url('?action=sessions'), { host: 'evil.localhost' })).status, 403)
  assert.equal((await send(host.url('?action=sessions'), { origin: `http://127.0.0.1:${host.port + 1}` })).status, 403)
  assert.equal((await send(host.url('?action=sessions'), { host: `[::1]:${host.port}`, origin: `http://[::1]:${host.port}` })).status, 200)

  const open = await send(host.url('?action=sessions'))
  assert.equal(open.status, 200)
  // 响应策略来自嵌入的 `dsh-host-http` 片段：带端口、pid 与会话 id 的响应体
  // 绝不能从缓存提供。
  assert.equal(open.headers['cache-control'], 'no-store')
  assert.match(open.headers['content-type'], /^application\/json; charset=utf-8$/)
  assert.equal(open.body.availability, 'available')
  assert.equal(open.body.sessions[0].sessionId, 'sess-http-1')
  assert.equal(open.body.sessions[0].title, 'dsh-ballast')
  assert.equal(open.body.sessions[0].titleSource, 'cwd')
})

test('the mounted route rejects a remote peer, however local its headers look', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  // DSH 的 webserver 支持监听 0.0.0.0，而远程客户端会写自己的 Host 头，所以
  // 只检查 loopback Host 会让 sessions、measure 与 top 在机器外可读。真实
  // loopback socket 无法构造这种 peer；这里直接驱动路由。
  for (const action of ['sessions', 'measure&sessionId=sess-http-1', 'top']) {
    const chunks = []
    let status = null
    const res = {
      writeHead(code) { status = code },
      setHeader() { },
      end(text) { if (text) chunks.push(text) }
    }
    await host.route().handler({
      method: 'GET',
      url: `/dsh-ballast/api?action=${action}`,
      headers: { host: `127.0.0.1:${host.port}`, origin: `http://127.0.0.1:${host.port}`, 'sec-fetch-site': 'same-origin' },
      socket: { remoteAddress: '203.0.113.7' }
    }, res)
    assert.equal(status, 403, `action=${action} must not answer a remote peer`)
    const body = JSON.parse(chunks.join(''))
    assert.equal(body.code, 'non_loopback_peer')
    // 拒绝不能泄露它拒绝提供的数据。
    for (const field of ['sessions', 'measurement', 'availability', 'pid']) {
      assert.ok(!(field in body), `the rejection leaks ${field}`)
    }
  }
})

test('the route is read-only in its method shape, not just its handlers', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  assert.equal((await send(host.url('?action=sessions'))).status, 200)
  assert.equal((await send(host.url('?action=sessions'), {}, 'HEAD')).status, 200)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await send(host.url('?action=sessions'), {}, method)
    assert.equal(res.status, 405, `${method} must not be served by a read-only API`)
    assert.equal(res.body.code, 'method')
    assert.equal(res.headers.allow, 'GET, HEAD')
  }
  // 守卫在方法闸门之前运行：跨站请求不能走到得知路由接受哪些动词的一步。
  assert.equal((await send(host.url('?action=sessions'), { 'sec-fetch-site': 'cross-site' }, 'POST')).status, 403)
})

test('measure keeps its failure codes over HTTP', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  assert.equal((await send(host.url('?action=measure'))).status, 400)
  assert.equal((await send(host.url('?action=measure&sessionId=nope'))).status, 404)
  assert.equal((await send(host.url('?action=not-real'))).status, 400)
})

test('a priced surface yields heaviest-first rows with a real delta per row', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  const res = await send(host.url('?action=measure&sessionId=sess-http-1'))
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.title, 'dsh-ballast')
  const m = res.body.measurement
  assert.equal(m.shadowPricing, 'available')
  assert.equal(m.routePricedCount, 2)
  assert.deepEqual(m.rows.map((row) => row.seq), [2, 1, 0])
  assert.deepEqual(m.rows.map((row) => row.priceDelta), [31, -15, 0])
  for (const row of m.rows) {
    assert.equal(row.priceDelta, row.tokens - row.heuristicTokens)
    for (const field of ['seq', 'tokens', 'heuristicTokens', 'priceDelta', 'routePriced', 'type', 'time', 'surfaceOp', 'preview']) {
      assert.ok(field in row, `row ${row.seq} is missing ${field}`)
    }
  }
  assert.equal(m.rows[0].type, 'tool/result')
  assert.equal(typeof m.rows[0].preview.text, 'string')
})

test('a host without the shadow price answers nulls over HTTP, never delta === tokens', async (t) => {
  // 正是 rc.2 发送的内容：节点只带 `tokens`，缺席的影子价保持 null，所以
  // 没有行被读成路由定价且 delta === tokens。
  const host = await mount(SURFACE.nodes.map(({ seq, tokens }) => ({ seq, tokens })))
  t.after(() => host.dispose())

  const m = (await send(host.url('?action=measure&sessionId=sess-http-1'))).body.measurement
  assert.equal(m.shadowPricing, 'absent')
  assert.equal(m.routePricedCount, 0)
  assert.equal(m.nodeCount, 3)
  for (const row of m.rows) {
    assert.equal(row.heuristicTokens, null)
    assert.equal(row.priceDelta, null)
    assert.equal(row.routePriced, null)
    assert.ok(row.tokens > 0)
  }
})

test('a node whose price cannot be read is absence, not a measured zero', async (t) => {
  // 没有可读价格的节点是缺席：`tokens` 保持 null，并被排除在合计、排序与
  // 条宽之外；0 在那里会是一个价格。
  const host = await mount([
    { seq: 0, tokens: 15, heuristicTokens: 15 },
    { seq: 1, heuristicTokens: 55 },
    { seq: 2, tokens: 400, heuristicTokens: 369 }
  ])
  t.after(() => host.dispose())

  const m = (await send(host.url('?action=measure&sessionId=sess-http-1'))).body.measurement
  assert.deepEqual(m.rows.map((row) => row.seq), [2, 0, 1])
  const unreadable = m.rows[2]
  assert.equal(unreadable.tokens, null)
  assert.equal(unreadable.priceDelta, null)
  assert.equal(unreadable.routePriced, null)
  // 宿主确实发送的影子价仍然报告；缺席是按字段的。
  assert.equal(unreadable.heuristicTokens, 55)
  assert.equal(m.unpricedCount, 1)
  assert.equal(m.byType.total, 415)
  assert.equal(m.byType.types.find((g) => g.type === 'assistant/message').tokens, 0)
  assert.equal(m.byType.types.find((g) => g.type === 'assistant/message').count, 1)
})

test('an empty surface cannot be told apart, and says so', async (t) => {
  const host = await mount([])
  t.after(() => host.dispose())

  const m = (await send(host.url('?action=measure&sessionId=sess-http-1'))).body.measurement
  assert.equal(m.nodeCount, 0)
  assert.deepEqual(m.rows, [])
  assert.equal(m.shadowPricing, 'unknown')
})

test('action=top ranks live sessions by their heaviest node', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  const res = await send(host.url('?action=top'))
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.limit, 5)
  // 损坏会话被报告为一次失败，既不静默丢弃，也不让它拖垮整个答案。
  assert.equal(res.body.failedCount, 1)
  assert.equal(res.body.failures[0].sessionId, 'sess-broken')
  assert.equal(res.body.sessions.length, 1)
  const entry = res.body.sessions[0]
  assert.equal(entry.sessionId, 'sess-http-1')
  assert.equal(entry.title, 'dsh-ballast')
  assert.deepEqual(entry.rows.map((row) => row.tokens), [400, 40, 15])
  assert.equal(typeof entry.rows[0].preview.text, 'string')
})

test('action=top clamps its limit instead of trusting the query string', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  const capped = await send(host.url('?action=top&limit=9999'))
  assert.equal(capped.body.limit, 20)
  const floored = await send(host.url('?action=top&limit=0'))
  assert.equal(floored.body.limit, 1)
  assert.equal((await send(host.url('?action=top&limit=1'))).body.sessions[0].rows.length, 1)
})

test('action=top is read-only in its method shape too', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  assert.equal((await send(host.url('?action=top'), {}, 'POST')).status, 405)
})

test('action=cold lists stored sessions the live half cannot see', async (t) => {
  // 没有活跃 Agent 的会话没有 Session 对象，所以活跃读取都不适用：持久化
  // 快照是唯一的行来源，投影缓存是唯一的 token 数字。活跃会话不在列表里，
  // 因为面板已经显示它——把一段对话报告两次比报告一次更糟。
  const stored = [
    { header: { id: 'sess-http-1', cwd: '/live' }, revision: 9, eventCount: 3, sizeBytes: 100 },
    { header: { id: 'old-big', cwd: '/work/big' }, revision: 5, eventCount: 90, sizeBytes: 4_000_000 },
    { header: { id: 'old-small', cwd: '/work/small' }, revision: 2, eventCount: 10, sizeBytes: 2048 },
    // 无法低成本统计日志或其长度的后端会省略字段。这一行因此不带数字，
    // 这与零是不同的答案。
    { header: { id: 'old-unpriced', cwd: '/work/other' }, revision: 1 }
  ]
  const host = await mount(SURFACE.nodes, {
    extra: {
      sessionPersistence: { list: async () => stored },
      sessionProjectionCache: {
        cachedSnapshot: (header) => header.id === 'old-big'
          ? { values: { contextPressure: { pressureTokens: 400, contextWindow: 128000 }, tokenUsage: { outputTokens: 20, cacheReadTokens: 300 } } }
          : { values: { contextPressure: { pressureTokens: 200 } } }
      },
      sessionQuery: {
        readSession: async () => null,
        readTitleSnapshots: (ids) => ids.map((id) => ({
          status: 'fulfilled',
          value: { session: { id }, title: { title: `标题 ${id}` } }
        }))
      }
    }
  })
  t.after(() => host.dispose())

  const res = await send(host.url('?action=cold'))
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.storedAvailability, 'available')
  assert.deepEqual(res.body.sessions.map((row) => row.sessionId), ['old-big', 'old-small', 'old-unpriced'])
  const [big, small, unpriced] = res.body.sessions
  assert.equal(big.title, '标题 old-big')
  assert.equal(big.titleSource, 'title')
  assert.equal(big.sizeBytes, 4_000_000)
  assert.equal(big.eventCount, 90)
  assert.deepEqual(big.projections.contextPressure, { pressureTokens: 400, contextWindow: 128000 })
  // 缓存折算 token 数字，所以已存储行不读日志也能定价；它缺少的分母保持
  // 缺席，不被推断。
  assert.deepEqual(small.projections.contextPressure, { pressureTokens: 200 })
  assert.equal(unpriced.sizeBytes, null)
  assert.equal(unpriced.eventCount, null)
})

test('action=cold reports a data directory it could not read instead of an empty one', async (t) => {
  const host = await mount(SURFACE.nodes, {
    extra: {
      sessionPersistence: { list: async () => { throw new Error('locked') } }
    }
  })
  t.after(() => host.dispose())

  const res = await send(host.url('?action=cold'))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.sessions, [])
  assert.equal(res.body.storedAvailability, 'unavailable')
})

test('action=cold answers an empty list rather than a 500 without a persistence backend', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  const res = await send(host.url('?action=cold'))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.sessions, [])
  assert.equal(res.body.storedAvailability, 'unavailable')
})

test('action=cold is read-only in its method shape too', async (t) => {
  const host = await mount(SURFACE.nodes)
  t.after(() => host.dispose())

  assert.equal((await send(host.url('?action=cold'), {}, 'POST')).status, 405)
})
