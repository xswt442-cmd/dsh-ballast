import test from 'node:test'
import assert from 'node:assert/strict'
import { shapeMeasurement } from '../lib/meter.js'

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
