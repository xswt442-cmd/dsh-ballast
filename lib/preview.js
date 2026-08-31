// dsh-ballast content previews (M1-1).
//
// A row's tokens say how heavy a message is; without the text you cannot tell
// whether that weight is ballast. This module turns a durable session event
// into a bounded, single-line summary.
//
// Payload shapes are asymmetric (verified against deepseek-harness
// @ dsh-v0.1.2-alpha.2, packages/core/session/src/types.ts:244,257,275):
//   - 'user/message'   data IS the UserMessage        -> data.content
//   - 'assistant/message' data wraps the message      -> data.message.content
//   - 'tool/result'    data wraps a ToolResultMessage -> data.message.content[0]
//                                                        .content (nested again)
// Reading `data.content` for all three silently yields empty previews for two
// of the three rows, so the unwrap is per-type and per-type tested.
//
// Mirrors the harness's own canonical extractor
// (packages/session-query/session-query/src/extraction.ts): reasoning blocks
// are dropped from the preview and unknown block types are default-denied —
// ContentBlockMap is merge-extensible, so an unknown block is expected, not an
// error.
//
// Every function here is total: a malformed or unfamiliar event yields a thin
// preview, never a throw, because a preview must not be able to break the
// read-only measure route.

/** Bound the payload: previews summarise, they do not exfiltrate the log. */
export const PREVIEW_MAX_CHARS = 220

export const SURFACE_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])

const isBlockArray = (value) => Array.isArray(value)

/** Collapse runs of whitespace so a preview stays on one panel line. */
function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

/** Code-point safe truncation: never split an emoji in half. */
function clip(text, limit) {
  const chars = Array.from(text)
  if (chars.length <= limit) return { text, chars: chars.length, truncated: false }
  return { text: chars.slice(0, limit).join(''), chars: chars.length, truncated: true }
}

/**
 * tool/result carries only a `toolCallId` — the human-readable tool name lives
 * on the paired non-surface 'tool/call' event (core/session/src/types.ts:263),
 * which never appears in measure().nodes. So labelling a tool row requires a
 * callId -> name map built from the log. One pass per measurement.
 */
export function buildToolNameMap(events) {
  const names = new Map()
  if (!isBlockArray(events)) return names
  for (const event of events) {
    if (!event || event.type !== 'tool/call') continue
    const data = event.data
    if (!data || typeof data.callId !== 'string' || typeof data.name !== 'string') continue
    if (!names.has(data.callId)) names.set(data.callId, data.name)
  }
  return names
}

/**
 * Flatten content blocks to preview text. Recurses because a tool result's
 * blocks nest further content blocks (images included).
 */
function walkBlocks(blocks, out, depth) {
  if (!isBlockArray(blocks) || depth > 4) return out
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string' && block.text !== '') out.text.push(oneLine(block.text))
        break
      case 'reasoning':
        // Deliberately not previewed: chain-of-thought is the least
        // scannable content and the harness's own extractor drops it too.
        out.reasoning += 1
        break
      case 'image':
        out.images += 1
        break
      case 'tool-call':
        out.calls.push(typeof block.name === 'string' ? block.name : '(tool)')
        break
      case 'tool-result':
        if (block.isError === true) out.isError = true
        if (typeof block.toolCallId === 'string') out.toolCallIds.push(block.toolCallId)
        walkBlocks(block.content, out, depth + 1)
        break
      default:
        // Unknown block type (the map is open for plugin merges): count it,
        // never guess its shape.
        out.other += 1
    }
  }
  return out
}

function emptyWalk() {
  return { text: [], reasoning: 0, images: 0, calls: [], toolCallIds: [], isError: false, other: 0 }
}

/** `source.kind` tells a human prompt apart from plugin-injected context. */
function isInjected(message) {
  const source = message && message.source
  return !!source && typeof source.kind === 'string' && source.kind !== 'user'
}

/**
 * Unwrap the three surface payload shapes to the Message whose `content`
 * holds the blocks. Returns null for anything else.
 */
function messageOf(event) {
  const data = event.data
  if (!data || typeof data !== 'object') return null
  switch (event.type) {
    case 'user/message':
      return data
    case 'assistant/message':
    case 'tool/result':
      return data.message && typeof data.message === 'object' ? data.message : null
    default:
      return null
  }
}

/**
 * 'append' added the node at the tail; { op:'replace', start, end } is a
 * compaction write that collapsed a surface range. Only the kind is reported —
 * the range refers to surface positions, not event seqs.
 */
export function surfaceOpKind(event) {
  const op = event && event.surfaceOp
  if (op === 'append') return 'append'
  if (op && typeof op === 'object' && op.op === 'replace') return 'replace'
  return null
}

/**
 * Build a bounded preview for one durable event. Non-surface events yield
 * null so the panel can distinguish "no text" from "not a surface row".
 */
export function extractPreview(event, toolNames) {
  if (!event || typeof event.type !== 'string') return null
  if (!SURFACE_EVENT_TYPES.has(event.type)) return null
  const message = messageOf(event)
  if (!message || !isBlockArray(message.content)) {
    return { kind: event.type, text: '', chars: 0, truncated: false, blocks: 0, shape: 'unknown' }
  }
  const walk = walkBlocks(message.content, emptyWalk(), 0)
  const parts = []
  if (event.type === 'tool/result') {
    // The nested tool-result block carries the payload; label it by name.
    const callId = walk.toolCallIds[0]
    const name = (callId && toolNames && toolNames.get(callId)) || null
    if (name) parts.push(`[${name}]`)
    else parts.push('[tool]')
  }
  if (walk.text.length) parts.push(walk.text.join(' '))
  if (walk.calls.length) parts.push(`→ ${walk.calls.join(', ')}`)
  const joined = oneLine(parts.join(' '))
  const clipped = clip(joined, PREVIEW_MAX_CHARS)
  const preview = {
    kind: event.type,
    text: clipped.text,
    chars: clipped.chars,
    truncated: clipped.truncated,
    blocks: isBlockArray(message.content) ? message.content.length : 0
  }
  if (walk.images) preview.images = walk.images
  if (walk.reasoning) preview.reasoning = walk.reasoning
  if (walk.other) preview.other = walk.other
  if (walk.isError) preview.isError = true
  if (event.type === 'tool/result' && message.content[0] && Array.isArray(message.content[0].content)) {
    preview.blocks = message.content[0].content.length
  }
  if (event.data && event.data.interrupted === true) preview.interrupted = true
  if (event.type === 'user/message' && isInjected(message)) preview.injected = true
  return preview
}
