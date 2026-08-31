import test from 'node:test'
import assert from 'node:assert/strict'
import { buildToolNameMap, extractPreview, surfaceOpKind, PREVIEW_MAX_CHARS } from '../lib/preview.js'

const text = (t) => ({ type: 'text', text: t })

// Payload shapes per core/session/src/types.ts:244,257,275 — user/message data
// IS the message; the other two wrap one level in .message.
const userEvent = (content, source = { kind: 'user' }) => ({
  type: 'user/message', seq: 0, time: 1000, surfaceOp: 'append', data: { id: 'm1', role: 'user', content, source }
})
const assistantEvent = (content, extra = {}) => ({
  type: 'assistant/message', seq: 1, time: 2000, surfaceOp: 'append',
  data: { turn: 1, step: 1, message: { id: 'm2', role: 'assistant', content, source: { kind: 'model' } }, ...extra }
})
const toolResultEvent = (toolCallId, content, extra = {}) => ({
  type: 'tool/result', seq: 2, time: 3000, surfaceOp: 'append',
  data: {
    turn: 1, step: 2,
    message: {
      id: 'm3', role: 'user', source: { kind: 'tool', callId: toolCallId },
      content: [{ type: 'tool-result', toolCallId, content }]
    },
    ...extra
  }
})

test('user/message previews its text blocks on one line', () => {
  const preview = extractPreview(userEvent([text('读取\n  config'), text('然后跑测试')]), new Map())
  assert.equal(preview.kind, 'user/message')
  assert.equal(preview.text, '读取 config 然后跑测试')
  assert.equal(preview.blocks, 2)
  assert.equal(preview.truncated, false)
})

test('assistant/message unwraps data.message before reading content', () => {
  const preview = extractPreview(assistantEvent([text('已完成')]), new Map())
  assert.equal(preview.text, '已完成')
})

test('tool/result unwraps data.message and the nested tool-result block', () => {
  const names = buildToolNameMap([{ type: 'tool/call', data: { callId: 'c1', name: 'read_file' } }])
  const preview = extractPreview(toolResultEvent('c1', [text('a\nb')]), names)
  assert.equal(preview.text, '[read_file] a b')
  assert.equal(preview.blocks, 1)
})

test('tool/result recurses into nested content blocks', () => {
  const preview = extractPreview(
    toolResultEvent('c9', [{ type: 'tool-result', toolCallId: 'inner', content: [text('深层输出')] }]),
    new Map()
  )
  assert.equal(preview.text, '[tool] 深层输出')
})

test('an unmatched toolCallId still labels the row as a tool', () => {
  const preview = extractPreview(toolResultEvent('missing', [text('out')]), new Map())
  assert.ok(preview.text.startsWith('[tool]'), preview.text)
})

test('tool errors are flagged without putting the text in a verdict', () => {
  const event = {
    type: 'tool/result', seq: 2, time: 3000,
    data: {
      turn: 1, step: 2,
      message: {
        role: 'user', source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [text('boom')] }]
      }
    }
  }
  const preview = extractPreview(event, new Map())
  assert.equal(preview.isError, true)
  assert.equal(preview.text, '[tool] boom')
})

test('tool/call blocks surface the called name', () => {
  const preview = extractPreview(assistantEvent([
    text('我先看一下'),
    { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }
  ]), new Map())
  assert.equal(preview.text, '我先看一下 → bash')
})

test('reasoning blocks are counted but never previewed', () => {
  const preview = extractPreview(assistantEvent([
    { type: 'reasoning', text: '长篇思考过程' },
    text('结论')
  ]), new Map())
  assert.equal(preview.text, '结论')
  assert.equal(preview.reasoning, 1)
})

test('images are counted, not inlined', () => {
  const preview = extractPreview(userEvent([
    { type: 'image', attachment: { id: 'att' } },
    text('看这张图')
  ]), new Map())
  assert.equal(preview.text, '看这张图')
  assert.equal(preview.images, 1)
})

test('plugin-injected user messages are distinguishable from human prompts', () => {
  const injected = extractPreview(userEvent([text('系统注入的上下文')], { kind: 'plugin', plugin: 'dsh-x' }), new Map())
  assert.equal(injected.injected, true)
  const human = extractPreview(userEvent([text('用户输入')]), new Map())
  assert.equal(human.injected, undefined)
})

test('an interrupted assistant message is flagged', () => {
  const preview = extractPreview(assistantEvent([text('写到一半')], { interrupted: true }), new Map())
  assert.equal(preview.interrupted, true)
})

test('a usage-only assistant step yields an empty preview, not a crash', () => {
  const preview = extractPreview(assistantEvent([]), new Map())
  assert.equal(preview.text, '')
  assert.equal(preview.blocks, 0)
})

test('unknown block types are counted and skipped, never guessed', () => {
  const preview = extractPreview(userEvent([
    { type: 'future-block', payload: { secret: true } },
    text('可见部分')
  ]), new Map())
  assert.equal(preview.text, '可见部分')
  assert.equal(preview.other, 1)
})

test('long previews clip on a code-point boundary and report the full length', () => {
  const body = '字'.repeat(PREVIEW_MAX_CHARS + 5)
  const preview = extractPreview(userEvent([text(body)]), new Map())
  assert.equal(preview.chars, PREVIEW_MAX_CHARS + 5)
  assert.equal(preview.truncated, true)
  assert.equal(Array.from(preview.text).length, PREVIEW_MAX_CHARS)

  // 219 ASCII + emoji puts the naive unit-level cut between a surrogate pair.
  const astral = 'a'.repeat(PREVIEW_MAX_CHARS - 1) + '🧱'.repeat(10)
  const clipped = extractPreview(userEvent([{ type: 'text', text: astral }]), new Map())
  assert.ok(!/[\uD800-\uDBFF]$/.test(clipped.text), 'a dangling high surrogate means the clip split a pair')
  assert.ok(Array.from(clipped.text).includes('🧱'), 'the first emoji must survive the clip whole')
})

test('non-surface events yield no preview', () => {
  assert.equal(extractPreview({ type: 'tool/call', data: { callId: 'c1', name: 'bash' } }, new Map()), null)
  assert.equal(extractPreview({ type: 'session/title', data: { title: 'x' } }, new Map()), null)
  assert.equal(extractPreview(null, new Map()), null)
  assert.equal(extractPreview({ type: 'user/message' }, new Map()).shape, 'unknown')
})

test('malformed surface payloads degrade to a thin preview', () => {
  assert.equal(extractPreview({ type: 'assistant/message', data: {} }, new Map()).shape, 'unknown')
  assert.equal(extractPreview({ type: 'tool/result', data: { message: {} } }, new Map()).shape, 'unknown')
  assert.equal(extractPreview({ type: 'user/message', data: { content: 'a bare string' } }, new Map()).shape, 'unknown')
})

test('buildToolNameMap takes the first name seen per callId and ignores junk', () => {
  const names = buildToolNameMap([
    null,
    { type: 'tool/call', data: { callId: 'c1', name: 'read' } },
    { type: 'tool/call', data: { callId: 'c1', name: 'shadowed' } },
    { type: 'tool/call', data: { name: 'no-call-id' } },
    { type: 'user/message', data: {} }
  ])
  assert.equal(names.get('c1'), 'read')
  assert.equal(names.size, 1)
  assert.equal(buildToolNameMap(undefined).size, 0)
})

test('surfaceOpKind reports append, replace and absence', () => {
  assert.equal(surfaceOpKind({ surfaceOp: 'append' }), 'append')
  assert.equal(surfaceOpKind({ surfaceOp: { op: 'replace', start: 3, end: 7 } }), 'replace')
  assert.equal(surfaceOpKind({}), null)
  assert.equal(surfaceOpKind(undefined), null)
})
