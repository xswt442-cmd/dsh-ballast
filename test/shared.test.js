import test from 'node:test'
import assert from 'node:assert/strict'
import { VERSION, createGuard, isLoopbackAddress, optionalSessionId } from '../lib/shared.js'
import { readFileSync } from 'node:fs'

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, pkg.version)
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
 * A request from a loopback peer, which is what every header-level case below
 * is about. `socket` is not optional detail: the guard rejects a request whose
 * peer it cannot identify, so a fake req without one never reaches the header
 * checks at all.
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
    // The v4-mapped form must not become a way past the 127/8 test.
    '::ffff:10.0.0.4', '::ffff:203.0.113.7',
    'fe80::1', '2001:db8::1',
    // A name is not an address: the guard resolves nothing.
    'localhost', '127.0.0.1.evil.example',
    // Absence is not permission.
    '', '   ', null, undefined
  ]) {
    assert.equal(isLoopbackAddress(address), false, `${String(address)} is not a loopback peer`)
  }
})

test('guard rejects a non-loopback peer whatever headers it sends', () => {
  const guard = createGuard({ currentPort: () => 3080 })
  // DSH can listen on 0.0.0.0, and a remote client writes its own Host. These
  // are the three shapes that used to read as local.
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
  const guard = createGuard()
  for (const req of [{ headers: {} }, { headers: {}, socket: {} }, { headers: {}, socket: { remoteAddress: '' } }]) {
    const res = mockRes()
    assert.equal(guard(req, res), false, 'an unidentifiable peer is not a local peer')
    assert.equal(JSON.parse(res.body).code, 'non_loopback_peer')
  }
})

test('guard admits every loopback peer form Node reports', () => {
  const guard = createGuard()
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(guard(mockReq({}, address), mockRes()), true, `${address} is local`)
  }
})

test('guard rejects cross-site fetch metadata', () => {
  const guard = createGuard()
  const res = mockRes()
  const ok = guard(mockReq({ 'sec-fetch-site': 'cross-site', host: '127.0.0.1:3080' }), res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'cross_site')
})

test('guard rejects a foreign Origin', () => {
  const guard = createGuard()
  const res = mockRes()
  const ok = guard(mockReq({ origin: 'https://evil.example', host: '127.0.0.1:3080' }), res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'foreign_origin')
})

test('guard rejects a non-loopback Host (DNS rebinding)', () => {
  const guard = createGuard()
  const res = mockRes()
  const ok = guard(mockReq({ host: 'rebound.example' }), res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'non_loopback')
})

test('guard admits only exact loopback hosts and matching Origins', () => {
  const guard = createGuard({ currentPort: () => 3080 })
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

test('an Origin on a default port matches the port the server runs on', () => {
  // `new URL('http://127.0.0.1:80').port` is '', which compared unequal to "80"
  // and turned a legitimate same-origin request into a 403.
  const onPort80 = createGuard({ currentPort: () => 80 })
  assert.equal(onPort80(mockReq({ host: '127.0.0.1', origin: 'http://127.0.0.1' }), mockRes()), true)
  assert.equal(onPort80(mockReq({ host: '127.0.0.1:80', origin: 'http://127.0.0.1:80' }), mockRes()), true)

  const onPort443 = createGuard({ currentPort: () => 443 })
  assert.equal(onPort443(mockReq({ host: '127.0.0.1', origin: 'https://127.0.0.1' }), mockRes()), true)

  // The implied port is still a port: it must not match a server on another one.
  const onPort3080 = createGuard({ currentPort: () => 3080 })
  const res = mockRes()
  assert.equal(onPort3080(mockReq({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1' }), res), false)
  assert.equal(JSON.parse(res.body).code, 'foreign_origin')
})

test('guard passes same-origin and host-side (headerless) callers', () => {
  const guard = createGuard()
  assert.equal(guard(mockReq({ 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3080' }), mockRes()), true)
  // plain node:http peer callers carry no fetch/origin/host headers
  assert.equal(guard(mockReq({}), mockRes()), true)
})

test('optionalSessionId trims and bounds input', () => {
  assert.equal(optionalSessionId('  abc  '), 'abc')
  assert.equal(optionalSessionId(''), null)
  assert.equal(optionalSessionId(42), null)
  assert.equal(optionalSessionId('x'.repeat(513)), null)
})
