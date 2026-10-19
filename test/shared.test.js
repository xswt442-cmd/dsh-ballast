import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VERSION, sendJson, ballastGuard, createBrowserAuthorizer, isLoopbackAddress, isLoopbackName, hostHostname, optionalSessionId
} from '../lib/shared.js'
import { readFileSync } from 'node:fs'

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, pkg.version)
})

// 带标记的片段是本插件发布的共享宿主胶水的唯一副本，所以手写的孪生实现或
// 第二对标记首先是正确性问题，其次才是风格问题。`check` 只改写一对标记之间
// 的片段，其他内容一概不管；它也只认识锁定 dock 版本携带的标记，所以发现
// 片段缺失或重复的是这里的断言，不是 `check`。
test('lib/shared.js embeds each dock fragment exactly once, in block order', () => {
  const source = readFileSync(new URL('../lib/shared.js', import.meta.url), 'utf8')
  const lines = source.split(/\r?\n/)
  const names = ['dsh-loopback-helpers', 'dsh-host-guard', 'dsh-host-http']
  for (const name of names) {
    assert.equal(lines.filter((line) => line.trim() === `// <${name}>`).length, 1,
      `exactly one opening marker for ${name}`)
    assert.equal(lines.filter((line) => line.trim() === `// </${name}>`).length, 1,
      `exactly one closing marker for ${name}`)
  }
  const starts = names.map((name) => lines.findIndex((line) => line.trim() === `// <${name}>`))
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b),
    'the guard reads the predicates the loopback block declares, and the HTTP glue lands below both')
})

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(text) { this.body = text }
  }
}

/**
 * 来自 loopback peer 的请求，下面所有头部层面的用例都以此为前提。`socket`
 * 不是可省略的细节：守卫会拒绝无法识别 peer 的请求，所以没有 socket 的
 * 假请求根本到不了头部检查。
 */
function mockReq(headers = {}, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } }
}

test('isLoopbackAddress admits loopback peers and fails closed otherwise', () => {
  for (const address of ['127.0.0.1', '127.0.0.53', '127.1.2.3', '::1', '::ffff:127.0.0.1', ' ::FFFF:127.0.0.1 ']) {
    assert.equal(isLoopbackAddress(address), true, `${address} is a loopback peer`)
  }
  for (const address of [
    '10.0.0.4', '192.168.1.9', '203.0.113.7',
    // v4 映射形式不能成为绕过 127/8 检查的途径。
    '::ffff:10.0.0.4', '::ffff:203.0.113.7',
    'fe80::1', '2001:db8::1',
    // 名字不是地址：守卫不做解析。
    'localhost', '127.0.0.1.evil.example',
    // 缺席不是许可。
    '', '   ', null, undefined
  ]) {
    assert.equal(isLoopbackAddress(address), false, `${String(address)} is not a loopback peer`)
  }
})

test('guard rejects a non-loopback peer whatever headers it sends', () => {
  const guard = ballastGuard({ currentPort: () => 3080 })
  // DSH 可以监听 0.0.0.0，远程客户端会写自己的 Host。下面三种头部单独看
  // 都像本地请求。
  for (const headers of [
    { host: '127.0.0.1:3080' },
    { host: 'localhost:3080', origin: 'http://localhost:3080', 'sec-fetch-site': 'same-origin' },
    {}
  ]) {
    const res = mockRes()
    assert.equal(guard(mockReq(headers, '203.0.113.7'), res), false)
    assert.equal(res.statusCode, 403)
    assert.equal(JSON.parse(res.body).code, 'non_loopback_peer')
  }
})

test('guard fails closed when the peer address is missing', () => {
  const guard = ballastGuard()
  for (const req of [{ headers: {} }, { headers: {}, socket: {} }, { headers: {}, socket: { remoteAddress: '' } }]) {
    const res = mockRes()
    assert.equal(guard(req, res), false, 'an unidentifiable peer is not a local peer')
    assert.equal(JSON.parse(res.body).code, 'non_loopback_peer')
  }
})

test('guard admits every loopback peer form Node reports', () => {
  const guard = ballastGuard()
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(guard(mockReq({}, address), mockRes()), true, `${address} is local`)
  }
})

test('guard rejects cross-site fetch metadata', () => {
  const guard = ballastGuard()
  const res = mockRes()
  const ok = guard(mockReq({ 'sec-fetch-site': 'cross-site', host: '127.0.0.1:3080' }), res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'cross_site')
})

test('guard rejects a foreign Origin', () => {
  const guard = ballastGuard()
  const res = mockRes()
  const ok = guard(mockReq({ origin: 'https://evil.example', host: '127.0.0.1:3080' }), res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'foreign_origin')
})

test('guard rejects a non-loopback Host (DNS rebinding)', () => {
  const guard = ballastGuard()
  const res = mockRes()
  const ok = guard(mockReq({ host: 'rebound.example' }), res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'non_loopback')
})

test('guard admits only exact loopback hosts and matching Origins', () => {
  const guard = ballastGuard({ currentPort: () => 3080 })
  const accepted = [
    { host: 'localhost:3080', origin: 'http://localhost:3080' },
    { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    { host: '[::1]:3080', origin: 'http://[::1]:3080' }
  ]
  for (const headers of accepted) assert.equal(guard(mockReq(headers), mockRes()), true)

  for (const headers of [
    { host: 'evil.localhost:3080' },
    { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3081' },
    { host: '[::1]:3080', origin: 'http://[::1]:3081' }
  ]) {
    const res = mockRes()
    assert.equal(guard(mockReq(headers), res), false)
    assert.equal(res.statusCode, 403)
  }
})

// 双栈浏览器通过 IPv4 映射的 IPv6 形式到达面板，所以共享守卫在
// `isLoopbackName` 里接受两种拼写——带点的 `[::ffff:127.0.0.1]` 与 WHATWG
// URL 解析器输出的 `[::ffff:7f00:1]`，Host 检查与 Origin 检查共用它。先折回
// IPv4 保证映射的公网地址（如 `[::ffff:8.8.8.8]`）仍被拒绝。
test('guard treats the IPv4-mapped IPv6 loopback form as loopback', () => {
  const guard = ballastGuard({ currentPort: () => 3080 })
  for (const host of ['[::ffff:127.0.0.1]:3080', '[::ffff:7f00:1]:3080']) {
    assert.equal(guard(mockReq({ host, 'sec-fetch-site': 'same-origin' }), mockRes()), true, `${host} is loopback`)
    assert.equal(isLoopbackName(hostHostname(host)), true, `${host} parses to a loopback name`)
  }
  // ……但映射形式不能成为绕过 127/8 检查的途径。
  for (const host of ['[::ffff:8.8.8.8]:3080', '[::ffff:203.0.113.7]:3080']) {
    const res = mockRes()
    assert.equal(guard(mockReq({ host, 'sec-fetch-site': 'same-origin' }), res), false, `${host} is not loopback`)
    assert.equal(res.statusCode, 403)
  }
})

// 主机名解析为空必须按拒绝处理。`hostHostname` 会在第一个冒号处拆分未加
// 方括号的 IPv6 字面量并返回 ''，单凭真值判断会完全跳过白名单。RFC 7230
// 禁止这种形式，但客户端仍可以发送，所以它是被拒绝，不是被放行。
test('guard fails closed on a Host header that parses to no hostname', () => {
  const guard = ballastGuard({ currentPort: () => 3080 })
  for (const host of ['::1:3080', '::ffff:127.0.0.1:3080']) {
    const res = mockRes()
    assert.equal(guard(mockReq({ host, 'sec-fetch-site': 'same-origin' }), res), false, `${host} is not a usable Host`)
    assert.equal(res.statusCode, 403)
    assert.equal(JSON.parse(res.body).code, 'non_loopback')
  }
  // 缺席的 Host 仍然放行：宿主侧调用方不带 Host 头。
  assert.equal(guard(mockReq({ 'sec-fetch-site': 'same-origin' }), mockRes()), true)
})

test('an Origin on a default port matches the port the server runs on', () => {
  // `new URL('http://127.0.0.1:80').port` 是 ''，直接与 "80" 比较会把合法的
  // 同源请求变成 403。
  const onPort80 = ballastGuard({ currentPort: () => 80 })
  assert.equal(onPort80(mockReq({ host: '127.0.0.1', origin: 'http://127.0.0.1' }), mockRes()), true)
  assert.equal(onPort80(mockReq({ host: '127.0.0.1:80', origin: 'http://127.0.0.1:80' }), mockRes()), true)

  const onPort443 = ballastGuard({ currentPort: () => 443 })
  assert.equal(onPort443(mockReq({ host: '127.0.0.1', origin: 'https://127.0.0.1' }), mockRes()), true)

  // 隐含端口仍然是端口：它不能匹配另一个端口上的服务器。
  const onPort3080 = ballastGuard({ currentPort: () => 3080 })
  const res = mockRes()
  assert.equal(onPort3080(mockReq({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1' }), res), false)
  assert.equal(JSON.parse(res.body).code, 'foreign_origin')
})

test('guard passes same-origin and host-side (headerless) callers', () => {
  const guard = ballastGuard()
  assert.equal(guard(mockReq({ 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3080' }), mockRes()), true)
  // 普通 node:http 调用方不带 fetch/origin/host 头
  assert.equal(guard(mockReq({}), mockRes()), true)
})

test('optionalSessionId trims and bounds input', () => {
  assert.equal(optionalSessionId('  abc  '), 'abc')
  assert.equal(optionalSessionId(''), null)
  assert.equal(optionalSessionId(42), null)
  assert.equal(optionalSessionId('x'.repeat(513)), null)
})

// `sendJson` 是嵌入的共享胶水，所以它添加的头部在这里断言：每个路由响应都
// 写明活跃宿主事实（端口、pid、会话 id），这正是 `no-store` 属于安全姿态
// 而非装饰的原因。
test('every JSON reply carries the no-store and JSON content policy', () => {
  const res = mockRes()
  sendJson(res, 200, { ok: true })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(res.body), { ok: true })
})

// 授权器通过访问器读取 Connection，因为捕获的值会继续对一个宿主已经销毁的
// Connection 授权。构造函数拒绝普通值，是在重载发生之前唯一能抓住这个错误的
// 地方。
test('the browser authorizer refuses a captured Connection and a missing guard', () => {
  const guard = ballastGuard()
  assert.throws(() => createBrowserAuthorizer({ getConnection: null, getConnectionSeen: () => false, guard }),
    /getConnection must be an accessor/)
  assert.throws(() => createBrowserAuthorizer({ getConnection: () => null, getConnectionSeen: false, guard }),
    /getConnectionSeen must be an accessor/)
  assert.throws(() => createBrowserAuthorizer({ getConnection: () => null, getConnectionSeen: () => false }),
    /guard is required/)
  assert.equal(typeof createBrowserAuthorizer({ getConnection: () => null, getConnectionSeen: () => false, guard }), 'function')
})
