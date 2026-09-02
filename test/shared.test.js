import test from 'node:test'
import assert from 'node:assert/strict'
import { VERSION, createGuard, optionalSessionId } from '../lib/shared.js'
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

test('guard rejects cross-site fetch metadata', () => {
  const guard = createGuard()
  const res = mockRes()
  const ok = guard({ headers: { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:3080' } }, res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'cross_site')
})

test('guard rejects a foreign Origin', () => {
  const guard = createGuard()
  const res = mockRes()
  const ok = guard({ headers: { origin: 'https://evil.example', host: '127.0.0.1:3080' } }, res)
  assert.equal(ok, false)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'foreign_origin')
})

test('guard rejects a non-loopback Host (DNS rebinding)', () => {
  const guard = createGuard()
  const res = mockRes()
  const ok = guard({ headers: { host: 'rebound.example' } }, res)
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
  for (const headers of accepted) assert.equal(guard({ headers }, mockRes()), true)

  for (const headers of [
    { host: 'evil.localhost:3080' },
    { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3081' },
    { host: '[::1]:3080', origin: 'http://[::1]:3081' }
  ]) {
    const res = mockRes()
    assert.equal(guard({ headers }, res), false)
    assert.equal(res.statusCode, 403)
  }
})

test('guard passes same-origin and host-side (headerless) callers', () => {
  const guard = createGuard()
  assert.equal(guard({ headers: { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3080' } }, mockRes()), true)
  // plain node:http peer callers carry no fetch/origin/host headers
  assert.equal(guard({ headers: {} }, mockRes()), true)
})

test('optionalSessionId trims and bounds input', () => {
  assert.equal(optionalSessionId('  abc  '), 'abc')
  assert.equal(optionalSessionId(''), null)
  assert.equal(optionalSessionId(42), null)
  assert.equal(optionalSessionId('x'.repeat(513)), null)
})
