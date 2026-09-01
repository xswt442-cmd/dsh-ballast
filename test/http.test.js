import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import apply from '../lib/index.js'

// The CI boot-check runs against a `dsh web` with no provider route, so its
// measurement always has 0 surface nodes and every per-row assertion there is
// vacuous. That silence is how M1 shipped a fabricated delta column. These
// tests put the real host half behind a real socket with real rows, so the
// guard and the row contract are asserted against traffic instead of shapes.

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

// A session whose log will not measure: one corrupt log must not hide the rest
// of the host, which only the cross-session scan can get wrong.
function brokenSession() {
  return { id: 'sess-broken', events: [{ seq: 0, type: 'user/message', time: 1, data: {} }], header: { cwd: '/tmp/broken' } }
}

/**
 * Mount the host half on a real loopback server.
 * @param nodes - what ctx.tokenMeter.measure reports for the live session.
 *   Pass pre-0.1.2-alpha.2 shaped nodes (no heuristicTokens) to probe the
 *   degraded host.
 */
async function mount(nodes) {
  const session = fakeSession()
  const broken = brokenSession()
  const routes = new Map()
  const disposed = []
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
        }
      })
    },
    on(event, fn) {
      if (event === 'dispose') disposed.push(fn)
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
  return {
    port,
    url: (query = '') => `http://127.0.0.1:${port}/dsh-ballast/api${query}`,
    dispose: async () => {
      for (const fn of disposed) await fn()
      server.close()
      await once(server, 'close')
    }
  }
}

/** Raw request so Host can be overridden — fetch() would normalise it away. */
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

  const open = await send(host.url('?action=sessions'))
  assert.equal(open.status, 200)
  assert.equal(open.body.availability, 'available')
  assert.equal(open.body.sessions[0].sessionId, 'sess-http-1')
  assert.equal(open.body.sessions[0].title, 'dsh-ballast')
  assert.equal(open.body.sessions[0].titleSource, 'cwd')
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
  // The guard runs before the method gate: a cross-site request must not get
  // far enough to learn which verbs the route accepts.
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
  // Exactly what rc.2 sends: nodes carry `tokens` only. Coercing the missing
  // field to 0 used to make every row look route-priced with delta === tokens.
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
  // `Number(node.tokens) || 0` used to turn a missing field into 0 — a legal
  // reading that then entered the totals, the sort and the bar widths.
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
  // The shadow price the host did send is still reported; absence is per field.
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
  // The corrupt session is reported as a failure, not silently dropped or
  // allowed to take the whole answer down.
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
