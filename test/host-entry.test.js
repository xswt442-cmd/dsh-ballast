import test from 'node:test'
import assert from 'node:assert/strict'
import plugin, { inject, apply } from '../lib/index.js'

test('host module exports a DSH plugin shape', () => {
  assert.equal(typeof apply, 'function')
  assert.equal(plugin, apply)
  assert.deepEqual(inject, ['webServer'])
  assert.deepEqual(apply.inject, ['webServer'])
})
