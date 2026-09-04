import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The client ships as one self-contained classic script, so its presentation
// logic cannot be imported. Grepping the bundle text for a field name is not
// enough either: it keeps passing when a label goes wrong, when a helper stops
// being called, or when the field only appears in a comment. So extract the
// React-free view-helpers region, evaluate it, and assert what the panel says.

const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const VIEW_MARK = '// ---- view helpers'
const PANEL_MARK = '// ---- panel'
const PLUGIN_MARK = '// ---- plugin'

function region(src, from, to) {
  const start = src.indexOf(from)
  const end = to ? src.indexOf(to, start) : src.length
  assert.ok(start >= 0, `${from} marker is missing from lib/client.js`)
  assert.ok(end > start, `${to} marker is missing after ${from} in lib/client.js`)
  return src.slice(start, end)
}

const VIEW_SRC = region(CLIENT_SRC, VIEW_MARK, PANEL_MARK)
const PANEL_SRC = region(CLIENT_SRC, PANEL_MARK, PLUGIN_MARK)

// The read paths are async and stateful, so unlike the view helpers they cannot
// be evaluated without React and a network. They are still where the panel gets
// its wrong-data-on-screen bugs, so the structure that keeps them honest is
// pinned here.
const LOAD_MEASURE_SRC = region(PANEL_SRC, 'const loadMeasure =', 'const loadTop =')
const LOAD_TOP_SRC = region(PANEL_SRC, 'const loadTop =', 'const refresh =')
const REFRESH_SRC = region(PANEL_SRC, 'const refresh =', 'React.useEffect(')

const HELPERS = ['fmt', 'fmtSigned', 'typeLabel', 'rowText', 'textHint',
  'timeLabel', 'baselineLabel', 'shadowBadge',
  'barWidth', 'sharePct', 'shareLabel', 'unpricedNote', 'snapshotAge',
  'releaseLoading']

// Keep copy assertions deterministic across developer machines and CI. Node 24
// exposes navigator.language, so otherwise the evaluated browser fallback uses
// the runner locale (en-US on GitHub, zh-CN on the maintainer machine).
const view = new Function(`const navigator = { language: 'zh-CN' }
${VIEW_SRC}
return { ${HELPERS.join(', ')} }`)()

test('the view region is presentation only, so evaluating it is fair', () => {
  // If the region ever reaches for React, the DOM or the network, the harness
  // below stops being a unit test; say so instead of failing obscurely.
  assert.ok(!/React\.|document\.|window\.|fetch\(/.test(VIEW_SRC),
    'view helpers must stay free of React, DOM and I/O')
  for (const name of HELPERS) {
    assert.equal(typeof view[name], 'function', `${name} is not defined in the view region`)
  }
})

test('an unmeasured value never renders as 0', () => {
  assert.equal(view.fmt(1234), '1,234')
  assert.equal(view.fmt(0), '0')
  for (const missing of [null, undefined, NaN, '1234']) {
    assert.equal(view.fmt(missing), '—', `${missing} is absent, not a measured zero`)
  }
})

test('signed quantities always carry their sign', () => {
  assert.equal(view.fmtSigned(1234), '+1,234')
  assert.equal(view.fmtSigned(-1234), '-1,234')
  assert.equal(view.fmtSigned(0), '0')
  assert.equal(view.fmtSigned(null), '—')
})

test('row types fall back to the raw type, then to a marker', () => {
  assert.equal(view.typeLabel({ type: 'user/message' }), '用户')
  assert.equal(view.typeLabel({ type: 'assistant/message' }), '助手')
  assert.equal(view.typeLabel({ type: 'tool/result' }), '工具')
  assert.equal(view.typeLabel({ type: 'future/kind' }), 'future/kind')
  assert.equal(view.typeLabel({}), '?')
})

test('an unreadable payload is not reported as empty content', () => {
  assert.equal(view.rowText({ type: 'user/message' }), '(无正文)')
  assert.equal(view.rowText({}), '(事件缺失)')
  assert.equal(view.rowText({ preview: { shape: 'unknown' } }), '(未识别正文)')
  assert.equal(view.rowText({ preview: {} }), '(空)')
  assert.equal(view.rowText({ preview: { kind: 'tool/result' } }), '(空结果)')
  assert.equal(view.rowText({ preview: { images: 2, reasoning: 1 } }), '(2 张图片 · 仅推理内容)')
  assert.equal(view.rowText({ preview: { text: '正文', images: 9 } }), '正文')
})

test('a clipped preview says so and names the pre-clip length', () => {
  assert.equal(view.textHint({ preview: { text: 'abc' } }), 'abc')
  assert.equal(view.textHint({ preview: { text: 'abc', truncated: true, chars: 512 } }),
    'abc（已截断，原文 512 字符）')
  // chars is payload metadata the host may omit; the note must not become "原文 — 字符".
  assert.equal(view.textHint({ preview: { text: 'abc', truncated: true } }),
    'abc（已截断，原文 — 字符）')
})

test('the seq tooltip renders only a time the plugin can read unambiguously', () => {
  assert.match(view.timeLabel('2026-09-01T05:40:21.000Z'), /2026/)
  // A bare number might be seconds or milliseconds and the meter does not know
  // which; rendering either guess would put a 1970 timestamp on screen.
  for (const junk of [null, undefined, '', 'not a time', {}, Date.parse('2026-09-01T05:40:21.000Z')]) {
    assert.equal(view.timeLabel(junk), '', `${String(junk)} must not render a time`)
  }
})

test('a baseline with no anchor is not given a token count', () => {
  assert.equal(view.baselineLabel({ kind: 'none', tokens: 0 }), 'baseline none')
  assert.equal(view.baselineLabel({ kind: 'estimated', tokens: 4321 }), 'baseline estimated 4,321')
  assert.equal(view.baselineLabel({ kind: 'usage' }), 'baseline usage')
  assert.equal(view.baselineLabel(null), 'baseline unknown')
})

test('the shadow-price badge matches what the host actually omitted', () => {
  assert.equal(view.shadowBadge({ shadowPricing: 'available' }), null)
  // An empty surface cannot tell the two host shapes apart: nothing to warn about.
  assert.equal(view.shadowBadge({ shadowPricing: 'unknown' }), null)
  assert.equal(view.shadowBadge({ shadowPricing: 'absent' }).label, '无影子价')
  const partial = view.shadowBadge({ shadowPricing: 'partial' })
  assert.equal(partial.label, '影子价不全')
  // The absent wording blames the host version, which is false for a partial surface.
  assert.ok(!partial.title.includes('此 DSH 宿主不提供'), 'partial must not claim the host lacks shadow pricing')
})

test('an unpriced row gets no bar, and the smallest priced row stays visible', () => {
  assert.equal(view.barWidth({ tokens: 1000 }, 1000), '100%')
  assert.equal(view.barWidth({ tokens: 1 }, 1000), '2%')
  // A 0.1% sliver would read as "this row is cheap"; the truth is "no number".
  assert.equal(view.barWidth({ tokens: null }, 1000), '0%')
  assert.equal(view.barWidth({ tokens: '900' }, 1000), '0%')
  assert.equal(view.barWidth({ tokens: NaN }, 1000), '0%')
  // With nothing measured, every row is 0% rather than a division by zero.
  assert.equal(view.barWidth({ tokens: 5 }, 0), '0%')
  assert.equal(view.barWidth({ tokens: 5 }, null), '0%')
})

test('the share legend names the type, the fraction and the volume', () => {
  const line = view.shareLabel({ type: 'user/message', tokens: 4321, count: 3, share: 0.25 })
  assert.equal(line, '用户 25.0% · 4,321 tokens / 3 条')
  // An unknown type label falls through to the raw type, like the row list does.
  assert.match(view.shareLabel({ type: 'future/kind', tokens: 0, count: 0, share: 0 }), /^future\/kind 0\.0%/)
  assert.equal(view.sharePct(0.256, 1), '25.6')
  assert.equal(view.sharePct(0.256, 0), '26')
  // share is host-computed; a missing one must not paint "NaN%" as a bar width.
  for (const junk of [null, undefined, NaN, '0.4', {}]) {
    assert.equal(view.sharePct(junk, 2), '0', `${String(junk)} is not a share`)
  }
})

test('unpriced rows are announced as a count, not silently dropped', () => {
  assert.equal(view.unpricedNote({ unpricedCount: 0 }), null)
  assert.equal(view.unpricedNote(null), null)
  assert.equal(view.unpricedNote(undefined), null)
  const note = view.unpricedNote({ unpricedCount: 2 })
  assert.equal(note.label, '2 条价格不可读')
  assert.ok(note.title.includes('不代表 0'), 'the note must say absence is not zero')
})

test('snapshot age is reported only when both clocks are readable', () => {
  const t = 1_700_000_000_000
  assert.equal(view.snapshotAge(t, t + 3_000), '3 秒前')
  assert.equal(view.snapshotAge(t, t + 150_000), '2 分钟前')
  assert.equal(view.snapshotAge(t, t + 7_200_000), '2 小时前')
  // A clock that went backwards means the page time is not trustworthy; say nothing.
  assert.equal(view.snapshotAge(t, t - 1), '')
  for (const junk of [null, undefined, 'now', {}]) {
    assert.equal(view.snapshotAge(junk, t), '', `${String(junk)} is not a receive time`)
    assert.equal(view.snapshotAge(t, junk), '', `${String(junk)} is not a clock reading`)
  }
})

test('the panel calls every helper instead of formatting inline', () => {
  const calls = [
    'fmt(measurement.totalTokens)',
    'fmtSigned(measurement.surfaceDeltaTokens)',
    'baselineLabel(measurement.baseline)',
    'shadowBadge(measurement)',
    'typeLabel(row)',
    'rowText(row)',
    'textHint(row)',
    'timeLabel(row.time)',
    'fmtSigned(row.priceDelta)',
    'barWidth(row, max)',
    'sharePct(group.share, 2)',
    'shareLabel(group)',
    'unpricedNote(measurement)',
    'snapshotAge(state.receivedAt, Date.now())'
  ]
  for (const call of calls) {
    assert.ok(PANEL_SRC.includes(call), `panel does not call ${call}`)
  }
  assert.ok(!PANEL_SRC.includes('.toFixed('),
    'number formatting must live in a view helper, not in the panel')
  assert.ok(!PANEL_SRC.includes('.baseline.kind'),
    'the panel must read the baseline through baselineLabel')
  assert.ok(!PANEL_SRC.includes('row.tokens / max'),
    'bar sizing must live in barWidth, not inline')
  assert.ok(!/>0 \? '\+' : ''/.test(PANEL_SRC),
    'sign handling must live in fmtSigned, not inline')
  // measure_failed and top_partial carry the reason the host threw; a bare code
  // tells the user nothing, so every api path must prefer the message.
  const withMessage = PANEL_SRC.match(/body\.error \|\| body\.code/g) || []
  assert.equal(withMessage.length, 3,
    'every api path should surface the host error message')
})

test('the panel surfaces every row field the meter emits', () => {
  // Pinned against the panel body: a field that only survives in dead code or a
  // comment must not pass this.
  for (const field of ['row.priceDelta', 'row.routePriced', 'row.surfaceOp',
    'row.preview', 'row.tokens', 'row.seq', 'row.time', 's.title']) {
    assert.ok(PANEL_SRC.includes(field), `panel never reads ${field}`)
  }
})

test('the panel surfaces the aggregate and the cross-session result', () => {
  for (const field of ['measurement.byType', 'host.sessions', 'host.limit',
    'host.failures', 'host.failedCount', 'entry.surfaceTokens', 'entry.title',
    'entry.rows', 'group.share']) {
    assert.ok(PANEL_SRC.includes(field), `panel never reads ${field}`)
  }
})

test('every read owns its network failure instead of raising it into the page', () => {
  // Only res.json() was guarded before. A rejected fetch() — DSH restarting,
  // HMR dropping the socket — became a browser unhandled rejection, and the
  // panel went on showing the previous snapshot as if the read had worked.
  for (const [name, src] of [['loadMeasure', LOAD_MEASURE_SRC], ['loadTop', LOAD_TOP_SRC]]) {
    assert.match(src, /try \{[\s\S]*?await fetch\(/, `${name} must call fetch inside a try`)
    const caught = src.slice(src.indexOf('} catch'))
    assert.ok(caught.length > 0, `${name} never catches its fetch`)
    assert.match(caught, /gen !== generation\.current/,
      `${name} must not report a read the panel has already moved past`)
    assert.match(caught, /setState\(/, `${name} must put the failure on screen`)
  }
})

test('a queued read is either awaited or explicitly fire-and-forget', () => {
  // An unmarked call reads as an oversight; `void` is what says the handler is
  // done once the read is queued and the loader owns its own errors.
  const callSites = PANEL_SRC.replace(/const (loadMeasure|loadTop|refresh) = React\.useCallback/g, '')
  const found = [...callSites.matchAll(/(\S+\s+)?\b(loadMeasure|loadTop|refresh)\(/g)]
  assert.ok(found.length >= 5, 'the panel should have call sites for all three reads')
  for (const match of found) {
    const lead = (match[1] || '').trim()
    assert.ok(lead === 'void' || lead === 'await',
      `${match[2]}() must be awaited or marked void, got "${match[0].trim()}"`)
  }
})

test('a refresh runs under one generation and honours the newest target', () => {
  // The sessions read is only half a refresh; the measurement that follows it
  // belongs to the same intent, so one stamp covers both.
  assert.match(REFRESH_SRC, /const gen = \+\+generation\.current/, 'refresh must stamp a generation')
  assert.match(REFRESH_SRC, /gen !== generation\.current/, 'refresh must drop a superseded answer')
  // Reading the captured state was the bug: a session picked while the read was
  // in flight got overwritten by the selection the closure started with.
  assert.ok(!/state\.selected/.test(REFRESH_SRC), 'refresh must not trust the captured selection')
  assert.ok(!/state\.view/.test(REFRESH_SRC), 'refresh must not trust the captured view')
  assert.match(REFRESH_SRC, /stateRef\.current/, 'refresh must read the newest selection and view')
  assert.match(REFRESH_SRC, /\}, \[loadMeasure, loadTop\]\)/,
    'refresh no longer depends on the captured selection or view')
  // `loading` disables the refresh button, so it has to be released — but only
  // by the refresh that owns it. Closing and reopening the panel starts a
  // second refresh; the first one returning late must not hand back a spinner
  // the newer read is still holding (REVIEW-0904 P2).
  assert.match(REFRESH_SRC, /loadingOwner\.current = gen/, 'a refresh takes ownership of the spinner')
  assert.ok(!/loading: false/.test(REFRESH_SRC),
    'refresh must not clear loading inline; ownership decides who may')
  assert.match(REFRESH_SRC, /releaseLoading\(loadingOwner, gen\)/,
    'every exit path releases loading through the ownership gate')
})

test('a refresh releases the spinner only while it owns it', () => {
  // A superseded refresh used to clear `loading` unconditionally, so a stale
  // read re-enabled the button while a newer one was still in flight.
  const owner = { current: 7 }
  assert.deepEqual(view.releaseLoading(owner, 7), { loading: false })
  assert.equal(owner.current, 0, 'releasing hands ownership back')

  const takenOver = { current: 8 }
  assert.equal(view.releaseLoading(takenOver, 7), null,
    'a refresh that lost ownership must not clear the spinner')
  assert.equal(takenOver.current, 8, 'the newer refresh keeps ownership')

  assert.equal(view.releaseLoading(null, 7), null)
})

test('unmounting the panel invalidates reads that are still in flight', () => {
  // HMR or plugin dispose removes the slot while fetches are pending: those
  // closures hold setState for a component that is gone. Bumping the
  // generation makes every pending read stale at its own guard (REVIEW-0904 P3).
  const cleanup = PANEL_SRC.slice(PANEL_SRC.indexOf('return () => {'))
  assert.match(cleanup, /generation\.current \+= 1/, 'cleanup must invalidate pending reads')
  assert.match(cleanup, /loadingOwner\.current = 0/, 'cleanup must drop the spinner owner')
  // Invalidation alone is not enough: a stale read that settles after unmount
  // must return *before* scheduling a state update on the gone component, not
  // call setState with an empty patch. The refresh catch branch and the
  // superseded branch each compute ownership first and bail out when there is
  // nothing left to write.
  const catchBranch = REFRESH_SRC.slice(REFRESH_SRC.indexOf('const released = releaseLoading'),
    REFRESH_SRC.indexOf('if (gen !== generation.current) {'))
  assert.match(catchBranch, /if \(!released && gen !== generation\.current\) return/,
    'the catch branch must return without setState once the read is dead')
  const superseded = REFRESH_SRC.slice(REFRESH_SRC.indexOf('if (gen !== generation.current) {'))
  assert.match(superseded, /const released = releaseLoading\(loadingOwner, gen\)/)
  assert.match(superseded, /if \(released\) setState/, 'a superseded read only touches state while it still owns the spinner')
})
