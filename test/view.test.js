import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 客户端以单个自包含经典脚本发布，展示逻辑无法 import。对 bundle 文本匹配
// 字段名也不够：标签出错、辅助函数不再被调用、字段只出现在注释里时，文本
// 匹配仍然通过。所以这里抽出不依赖 React 的视图辅助函数区域，求值它，并
// 断言面板显示了什么。

const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const VIEW_MARK = '// ---- 视图辅助函数'
const PANEL_MARK = '// ---- 面板'
const PLUGIN_MARK = '// ---- 插件'

function region(src, from, to) {
  const start = src.indexOf(from)
  const end = to ? src.indexOf(to, start) : src.length
  assert.ok(start >= 0, `${from} marker is missing from lib/client.js`)
  assert.ok(end > start, `${to} marker is missing after ${from} in lib/client.js`)
  return src.slice(start, end)
}

const VIEW_SRC = region(CLIENT_SRC, VIEW_MARK, PANEL_MARK)
const PANEL_SRC = region(CLIENT_SRC, PANEL_MARK, PLUGIN_MARK)

// 读取路径是异步且有状态的，与视图辅助函数不同，没有 React 和网络无法求值。
// 但它们正是面板显示错误数据的来源，所以这里固定让它们保持正确的结构。
const LOAD_MEASURE_SRC = region(PANEL_SRC, 'const loadMeasure =', 'const loadTop =')
const LOAD_TOP_SRC = region(PANEL_SRC, 'const loadTop =', 'const loadCold =')
const LOAD_COLD_SRC = region(PANEL_SRC, 'const loadCold =', 'const loadHostView =')
const REFRESH_SRC = region(PANEL_SRC, 'const refresh =', 'React.useEffect(')

const HELPERS = ['fmt', 'fmtSigned', 'typeLabel', 'rowText', 'textHint',
  'timeLabel', 'baselineLabel', 'shadowBadge',
  'barWidth', 'sharePct', 'shareLabel', 'unpricedNote', 'snapshotAge',
  'releaseLoading', 'factSummary', 'sizeLabel', 'coldPressure']

// 让文案断言在开发机与 CI 上保持一致。Node 24 暴露 navigator.language，
// 否则求值出的浏览器语言回退会使用运行器语言（GitHub 上是 en-US，维护者
// 机器上是 zh-CN）。
const view = new Function(`const navigator = { language: 'zh-CN' }
${VIEW_SRC}
return { ${HELPERS.join(', ')} }`)()

test('the view region is presentation only, so evaluating it is fair', () => {
  // 如果这个区域访问 React、DOM 或网络，下面的测试装置就不再是单元
  // 测试；在这里直接说明，而不是让失败难以理解。
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
  // chars 是宿主可能省略的载荷元数据；提示不能变成“原文 — 字符”。
  assert.equal(view.textHint({ preview: { text: 'abc', truncated: true } }),
    'abc（已截断，原文 — 字符）')
})

test('the seq tooltip renders only a time the plugin can read unambiguously', () => {
  assert.match(view.timeLabel('2026-09-01T05:40:21.000Z'), /2026/)
  // 裸数字可能是秒也可能是毫秒，计量服务不知道是哪一种；猜任何一个都会在
  // 屏幕上显示 1970 年的时间。
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
  // 空 surface 无法区分两种宿主形状：没有需要警告的内容。
  assert.equal(view.shadowBadge({ shadowPricing: 'unknown' }), null)
  assert.equal(view.shadowBadge({ shadowPricing: 'absent' }).label, '无影子价')
  const partial = view.shadowBadge({ shadowPricing: 'partial' })
  assert.equal(partial.label, '影子价不全')
  // “宿主不提供”的措辞对部分缺失的 surface 是错的。
  assert.ok(!partial.title.includes('此 DSH 宿主不提供'), 'partial must not claim the host lacks shadow pricing')
})

test('an unpriced row gets no bar, and the smallest priced row stays visible', () => {
  assert.equal(view.barWidth({ tokens: 1000 }, 1000), '100%')
  assert.equal(view.barWidth({ tokens: 1 }, 1000), '2%')
  // 0.1% 的细条会读成“这一行很便宜”；真相是“没有数字”。
  assert.equal(view.barWidth({ tokens: null }, 1000), '0%')
  assert.equal(view.barWidth({ tokens: '900' }, 1000), '0%')
  assert.equal(view.barWidth({ tokens: NaN }, 1000), '0%')
  // 没有可计量内容时，每一行都是 0%，而不是除零。
  assert.equal(view.barWidth({ tokens: 5 }, 0), '0%')
  assert.equal(view.barWidth({ tokens: 5 }, null), '0%')
})

test('the share legend names the type, the fraction and the volume', () => {
  const line = view.shareLabel({ type: 'user/message', tokens: 4321, count: 3, share: 0.25 })
  assert.equal(line, '用户 25.0% · 4,321 tokens / 3 条')
  // 未知类型标签会像行列表一样落到原始类型。
  assert.match(view.shareLabel({ type: 'future/kind', tokens: 0, count: 0, share: 0 }), /^future\/kind 0\.0%/)
  assert.equal(view.sharePct(0.256, 1), '25.6')
  assert.equal(view.sharePct(0.256, 0), '26')
  // share 由宿主计算；缺失的值不能把“NaN%”画成条宽。
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
  // 时钟倒退说明页面时间不可信；什么都不说。
  assert.equal(view.snapshotAge(t, t - 1), '')
  for (const junk of [null, undefined, 'now', {}]) {
    assert.equal(view.snapshotAge(junk, t), '', `${String(junk)} is not a receive time`)
    assert.equal(view.snapshotAge(t, junk), '', `${String(junk)} is not a clock reading`)
  }
})

test('a session fact line names only what the host measured', () => {
  // 没有缓存：悬停席位只提供动作，不显示任何数字，因为破折号或 0 会读成
  // 插件从未做过的计量。
  assert.equal(view.factSummary(null), '')
  assert.equal(view.factSummary(undefined), '')
  assert.equal(view.factSummary({}), '')
  // 会话列表不带 token 数字；日志长度是它唯一真正携带的内容，而且它是
  // 回退项，不是主信息。
  assert.equal(view.factSummary({ eventCount: 12 }), '日志 12 条')
  // 计量事实优先于日志长度，宿主给出的非数字字段不会被转成数字。
  assert.equal(view.factSummary({ surfaceTokens: 1234, eventCount: 12 }), 'surface 1,234')
  assert.equal(view.factSummary({
    surfaceTokens: 1234, eventCount: 12, heaviest: { seq: 7, tokens: 900 }
  }), 'surface 1,234 · 最重 #7 900')
  assert.equal(view.factSummary({ surfaceTokens: '1234' }), '',
    'a string is not a token figure')
  assert.equal(view.factSummary({ heaviest: { seq: 7, tokens: null } }), '',
    'an unpriced heaviest entry is not a number')
  assert.equal(view.factSummary({ heaviest: { seq: null, tokens: 900 } }), '最重 900',
    'a missing seq is dropped, not rendered as #null')
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
    'snapshotAge(state.receivedAt, Date.now())',
    'sizeLabel(entry.sizeBytes)',
    'coldPressure(entry)'
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
  // measure_failed 与 top_partial 携带宿主抛出的原因；只给一个 code 对用户
  // 没有帮助，所以每条 api 路径都必须优先显示消息。
  const withMessage = PANEL_SRC.match(/body\.error \|\| body\.code/g) || []
  assert.equal(withMessage.length, 4,
    'every api path should surface the host error message')
})

test('the panel surfaces every row field the meter emits', () => {
  // 对照面板主体固定：只活在死代码或注释里的字段不能通过。
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

test('the panel surfaces the stored half of the host view', () => {
  // 已存储会话没有活跃 Agent，活跃行的字段对它都不存在：面板必须读取
  // 持久化快照，并且必须在活跃扫描仍在运行时也渲染存储部分。
  for (const field of ['state.cold', 'state.coldLoading', 'state.coldStoredAvailable',
    'entry.sizeBytes', 'entry.eventCount', 'coldPressure(entry)']) {
    assert.ok(PANEL_SRC.includes(field), `panel never reads ${field}`)
  }
  assert.match(PANEL_SRC, /loadHostView/, 'the host view reads both halves')
  const hostView = PANEL_SRC.slice(PANEL_SRC.indexOf('isHostView'))
  assert.ok(hostView.indexOf('coldRows.map') > hostView.indexOf("tr('host.measuring')"),
    'the stored list must not wait on the live scan')
})

test('sizeLabel refuses to invent a size for a session it cannot measure', () => {
  assert.equal(view.sizeLabel(0), '—')
  assert.equal(view.sizeLabel(null), '—')
  assert.equal(view.sizeLabel(undefined), '—')
  assert.equal(view.sizeLabel('2048'), '—', 'a string is not a byte count')
  assert.equal(view.sizeLabel(999), '999 B')
  assert.equal(view.sizeLabel(1_024), '1 KB')
  assert.equal(view.sizeLabel(1_536), '1.5 KB')
  assert.equal(view.sizeLabel(5_242_880), '5 MB')
  assert.equal(view.sizeLabel(3_221_225_472), '3 GB')
})

test('coldPressure is silent without a pressure projection', () => {
  assert.equal(view.coldPressure({}), null)
  assert.equal(view.coldPressure({ projections: null }), null)
  assert.equal(view.coldPressure({ projections: { tokenUsage: { outputTokens: 5 } } }), null)
  // 已存储行携带的是缓存在该会话最后写入时的内容，所以这一行与活跃视图
  // 使用同一条，措辞也相同。
  assert.equal(view.coldPressure({
    projections: { contextPressure: { pressureTokens: 400, projectedTokens: 455, contextWindow: 128000 } }
  }), '下次请求 455 / 128,000（0.4%）')
})

test('coldPressure falls back to the anchored reading when the projection has no estimate', () => {
  assert.equal(view.coldPressure({
    projections: { contextPressure: { pressureTokens: 400, contextWindow: 128000 } }
  }), '下次请求 400 / 128,000（0.3%）')
})

test('every read owns its network failure instead of raising it into the page', () => {
  // fetch() 被拒绝——DSH 重启、HMR 断开 socket——必须成为每条读取自己的
  // 失败：未捕获会成为浏览器未处理的拒绝，面板会继续把旧快照显示成一次
  // 成功的读取。
  for (const [name, src] of [['loadMeasure', LOAD_MEASURE_SRC], ['loadTop', LOAD_TOP_SRC], ['loadCold', LOAD_COLD_SRC]]) {
    assert.match(src, /try \{[\s\S]*?await fetch\(/, `${name} must call fetch inside a try`)
    const caught = src.slice(src.indexOf('} catch'))
    assert.ok(caught.length > 0, `${name} never catches its fetch`)
    assert.match(caught, /gen !== generation\.current/,
      `${name} must not report a read the panel has already moved past`)
    assert.match(caught, /setState\(/, `${name} must put the failure on screen`)
  }
})

test('a superseded stored-session read still hands its spinner back', () => {
  // `loadCold` 在检查代号之前就取走 `coldLoading`，所以面板已经越过的读取
  // 必须在退出时清除它。否则存储部分永远停在读取中：行与空状态都在这个标志
  // 后面，两者都不会渲染。
  const guards = [...LOAD_COLD_SRC.matchAll(/if \(gen !== generation\.current\) \{([\s\S]*?)\}/g)]
  assert.ok(guards.length >= 2, 'loadCold must guard both its failure and its answer')
  for (const [guard, body] of guards) {
    assert.match(body, /coldLoading: false/, `the guard "${guard.trim()}" must release coldLoading`)
  }
})

test('a queued read is either awaited or explicitly fire-and-forget', () => {
  // 未标记的调用看起来像疏忽；`void` 表明读取入队后处理函数就结束了，
  // 加载器自己负责错误。
  const callSites = PANEL_SRC.replace(/const (loadMeasure|loadTop|loadCold|loadHostView|refresh) = React\.useCallback/g, '')
  const found = [...callSites.matchAll(/(\S+\s+)?\b(loadMeasure|loadTop|loadCold|loadHostView|refresh)\(/g)]
  assert.ok(found.length >= 7, 'the panel should have call sites for all its reads')
  for (const match of found) {
    const lead = (match[1] || '').trim()
    assert.ok(lead === 'void' || lead === 'await',
      `${match[2]}() must be awaited or marked void, got "${match[0].trim()}"`)
  }
})

test('a refresh runs under one generation and honours the newest target', () => {
  // 会话读取只是刷新的一半；随后的计量属于同一个意图，所以一个代号覆盖
  // 两者。
  assert.match(REFRESH_SRC, /const gen = \+\+generation\.current/, 'refresh must stamp a generation')
  assert.match(REFRESH_SRC, /gen !== generation\.current/, 'refresh must drop a superseded answer')
  // 刷新通过 `stateRef` 读取最新状态，而不是闭包捕获的状态：读取途中选中的
  // 会话会被旧状态丢掉。
  assert.ok(!/state\.selected/.test(REFRESH_SRC), 'refresh must not trust the captured selection')
  assert.ok(!/state\.view/.test(REFRESH_SRC), 'refresh must not trust the captured view')
  assert.match(REFRESH_SRC, /stateRef\.current/, 'refresh must read the newest selection and view')
  assert.match(REFRESH_SRC, /\}, \[loadMeasure, loadHostView\]\)/,
    'refresh must depend only on its loaders')
  // `loading` 会禁用刷新按钮，所以必须释放——但只能由持有它的那次刷新
  // 释放。关闭再打开面板会启动第二次刷新；第一次晚返回时不能交回新读取仍在
  // 持有的加载状态。
  assert.match(REFRESH_SRC, /loadingOwner\.current = gen/, 'a refresh takes ownership of the spinner')
  assert.ok(!/loading: false/.test(REFRESH_SRC),
    'refresh must not clear loading inline; ownership decides who may')
  assert.match(REFRESH_SRC, /releaseLoading\(loadingOwner, gen\)/,
    'every exit path releases loading through the ownership gate')
})

test('a refresh releases the spinner only while it owns it', () => {
  // 只有持有 `loading` 的刷新可以清除它：过期的读取不能在新读取仍在进行时
  // 重新启用按钮。
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
  // HMR 或插件销毁会在 fetch 未完成时移除槽位：那些闭包持有已不存在组件的
  // setState。增加代号让每个待完成的读取在自己的守卫处失效。
  const cleanup = PANEL_SRC.slice(PANEL_SRC.indexOf('return () => {'))
  assert.match(cleanup, /generation\.current \+= 1/, 'cleanup must invalidate pending reads')
  assert.match(cleanup, /loadingOwner\.current = 0/, 'cleanup must drop the spinner owner')
  // 仅仅失效还不够：卸载后完成的过期读取必须在为已消失组件安排状态更新
  // 之前返回，而不是用一个空补丁调用 setState。刷新的 catch 分支与被取代
  // 分支都先计算持有关系，再在没有内容可写时退出。
  const catchBranch = REFRESH_SRC.slice(REFRESH_SRC.indexOf('const released = releaseLoading'),
    REFRESH_SRC.indexOf('if (gen !== generation.current) {'))
  assert.match(catchBranch, /if \(!released && gen !== generation\.current\) return/,
    'the catch branch must return without setState once the read is dead')
  const superseded = REFRESH_SRC.slice(REFRESH_SRC.indexOf('if (gen !== generation.current) {'))
  assert.match(superseded, /const released = releaseLoading\(loadingOwner, gen\)/)
  assert.match(superseded, /if \(released\) setState/, 'a superseded read only touches state while it still owns the spinner')
})
