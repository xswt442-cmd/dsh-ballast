// dsh-ballast 的计量桥。
//
// 把 ctx.tokenMeter（按路由定价的逐条消息计量）与 ctx.sessions（活跃会话
// 查找）接起来。两个服务都是核心服务，绑定规则仍然成立：访问 ctx 服务的
// 方法必须在 ctx.inject 围栏内绑定，不能在 apply() 时解构——围栏决定这些
// 服务的生命周期覆盖绑定。
//
// ctx.tokenMeter 与 ctx.sessionQuery 的粒度约定：
//   - ctx.tokenMeter.measure(session) 返回 TokenMeasurement：
//     { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens,
//       nodes: [{ seq, tokens, heuristicTokens }] }
//   - measure() 仅宿主可用：token-meter 的 ./client 导出不包含
//     TokenMeter/TokenMeasurement/measure，DOM 插件无法复制这条路径。
//   - nodes[] 已经是当前 surface：先 'append'、后来被压缩 'replace' 折叠的
//     事件不在其中。不要从 events.filter(e => e.surfaceOp) 重建 surface，
//     那会显示已被遮蔽的行。
//   - nodes[] 索引当前 surface，不是原始日志：`seq` 是添加该节点的事件的
//     seq；压缩折叠一段 surface 后，存活条目仍指向创建它们的事件 seq。
//   - measure() 为完整日志定价，包含继承的前缀，所以分叉会话会以自己的名字
//     报告父会话的对话。切分点是 Session.inheritedEventCount，下面的结构
//     按它拆分合计。
//
// 持久化日志通过 ctx.sessionQuery 读取。Session.eventAt() 与
// Session.snapshotEvents() 已弃用：同步读取任意位置要求完整序列常驻内存，
// 而存储方向正在去掉这个前提，所以查询服务是受支持的读取方式，需要它的
// 桥方法都是异步的。两个纯会话状态字段保持同步读取：Session.seq 表示日志
// 长度，Session.inheritedEventCount 表示分叉继承的前缀。
//
// 查询服务是可选的。没有它时，面板仍从存在的旧版 `events` 数组作答，并把
// 只有日志读取才能产生的字段报告为缺失——不做猜测。coldSessions() 没有
// 同步对应实现：已存储会话没有可供读取的 Session 对象。

import { buildToolNameMap, extractPreview, surfaceOpKind } from './preview.js'

/** 读取已存储会话时，面板会用到的投影键。 */
export const COLD_PROJECTION_KEYS = ['tokenUsage', 'contextPressure', 'contextBreakdown']

/**
 * 建立计量桥。两个必需服务都可用后 availability 才变成 'available'。
 */
export function createMeterBridge(ctx) {
  let meter = null
  let sessions = null
  let projections = null
  let query = null
  let persistence = null
  let projectionCache = null
  let ready = false

  // cordis 把回调当作插件执行：回调收到派生出的 *scope*，服务挂在 scope 上
  // （scope.tokenMeter），不会作为位置参数传入。从第二个参数读取会得到
  // undefined，从而让只读路由在真实宿主上崩溃。
  ctx.inject(['tokenMeter', 'sessions'], (scope) => {
    const candidateMeter = scope.tokenMeter
    const candidateSessions = scope.sessions
    if (!candidateMeter || !candidateSessions) return
    // 声明可用之前先检查服务形状：绑定了没有 measure() 的 tokenMeter 的宿主，
    // 否则会让 availability() 变成 'available'，然后每个请求都失败。
    if (typeof candidateMeter.measure !== 'function') return
    if (typeof candidateSessions.list !== 'function' || typeof candidateSessions.get !== 'function') return
    meter = candidateMeter
    sessions = candidateSessions
    ready = true
  })

  // 可选：没有投影注册表的宿主仍然得到核心面板。这一层与必需的
  // meter/sessions 围栏分开——把一个缺席的增强项放进那道围栏，会让受支持
  // 宿主上的核心面板一起下线。
  ctx.inject(['sessionProjections'], (scope) => {
    if (scope.sessionProjections) projections = scope.sessionProjections
  })

  // 精确的持久化日志读取：`readSession` 用于逐节点关联，`readTitleSnapshots`
  // 用于批量标题。两者在绑定时检查，因为缺少其一时桥会退回到旧版 `events`
  // 数组而不是失败；形状不全的服务会让每次行关联都变成被拒绝的 promise。
  ctx.inject(['sessionQuery'], (scope) => {
    const candidate = scope.sessionQuery
    if (!candidate) return
    if (typeof candidate.readSession !== 'function') return
    if (typeof candidate.readTitleSnapshots !== 'function') return
    query = candidate
  })

  // 已存储会话与为它作答的服务：投影缓存保存宿主已经折算好的数字，所以
  // 不读日志也能给已存储行定价。
  ctx.inject(['sessionPersistence'], (scope) => {
    if (scope.sessionPersistence) persistence = scope.sessionPersistence
  })
  ctx.inject(['sessionProjectionCache'], (scope) => {
    if (scope.sessionProjectionCache) projectionCache = scope.sessionProjectionCache
  })

  /**
   * 某个活跃会话的持久化日志；没有查询服务作答时返回 null。
   *
   * 返回的观察值就地使用，从不保存到 Session 上：缓存它会让完整事件序列以
   * 本插件的名义重新驻留内存，而 Session.snapshotEvents() 正是因为这一点
   * 被弃用。服务拒绝的日志不参与行关联，调用方渲染没有逐节点类型的计量
   * 结果，面板不因此失败。
   */
  async function readDurableLog(session) {
    if (!query || typeof query.readSession !== 'function') return null
    if (!session || session.id === undefined || session.id === null) return null
    try {
      const snapshot = await query.readSession(session.id)
      return snapshot && Array.isArray(snapshot.events) ? snapshot : null
    } catch {
      return null
    }
  }

  /**
   * 给定会话的持久化标题；查询服务完全无法作答时返回 null。
   *
   * 映射里只有服务读取并命名的行；读不到的行直接缺席，`null` 专指“没有
   * 服务或整批失败”——调用方对两者作同样处理，把该会话的标题槽留给同步扫描。
   */
  async function readTitles(sessionIds) {
    if (!query || typeof query.readTitleSnapshots !== 'function') return null
    if (sessionIds.length === 0) return new Map()
    let observations
    try {
      observations = await query.readTitleSnapshots(sessionIds)
    } catch (e) {
      // 整批读取失败，不是单行失败：记录下来，让持续的宿主故障可见，然后
      // 返回 null，交给同步扫描为各行取标题。面板仍可用，只是没有持久化
      // 标题路径。
      console.error('[dsh-ballast] readTitleSnapshots failed:', String((e && e.stack) || (e && e.message) || e))
      return null
    }
    if (!Array.isArray(observations)) return null
    const titles = new Map()
    for (const observation of observations) {
      // 单个会话读不到是那一行自己的事：在这里跳过，让同步扫描为它作答，
      // 列表其余部分保留服务已折算出的标题。
      if (!observation || observation.status !== 'fulfilled') continue
      const value = observation.value
      const session = value && value.session
      const title = value && value.title && typeof value.title.title === 'string' ? value.title.title.trim() : ''
      if (session && session.id !== undefined && title !== '') titles.set(String(session.id), title)
    }
    return titles
  }

  /**
   * 为日志自上次调用后增长过的会话填充标题缓存。
   *
   * `readTitleSnapshots` 从完整日志中折算标题，所以日志未变的会话不应重复
   * 读取——`derived` 里的修订号记录让空闲宿主的刷新不产生读取开销。
   *
   * 只缓存服务真正返回的标题。没有服务，或某行整批读取未成功时，槽位保持
   * 空，由 `resolveSessionTitle` 从本进程已持有的日志作答：日志带标题时能
   * 取到真实标题，否则退回工作区目录名。把退路写进缓存会让较差的答案在本
   * 进程余下的时间里固定下来。
   */
  async function loadTitles(live) {
    const pending = live.filter((session) => derivedRead(session, 'title') === undefined)
    if (pending.length === 0) return
    const titles = await readTitles(pending.map((session) => session.id))
    if (titles === null) return
    for (const session of pending) {
      const answer = titles.get(String(session.id))
      if (answer === undefined) continue
      derivedWrite(session, 'title', { title: answer, titleSource: 'title' })
    }
  }

  /**
   * 已经由 `loadTitles` 覆盖的会话标题；调用方遇到尚未见过的会话时退回
   * 同步扫描。
   */
  function titleOf(session) {
    const memoized = derivedRead(session, 'title')
    return memoized === undefined ? resolveSessionTitle(session) : memoized
  }

  function availability() {
    return ready ? 'available' : 'unavailable'
  }

  /**
   * 活跃会话，日志最大的在前。
   *
   * 异步是因为持久化标题读取是异步的：一次批量 `readTitleSnapshots` 观察值
   * 覆盖所有自上次调用后日志增长的会话，缓存让没有变化的刷新不产生开销。
   */
  async function listSessions() {
    if (!ready) return []
    const live = sessions.list()
    await loadTitles(live)
    const listed = live.map((session) => {
      const eventCount = eventCountOf(session)
      const inherited = inheritedEventCountOf(session)
      return {
        sessionId: session.id,
        // 新建的会话可能在事件日志初始化之前就可见（DSH alpha）。把这种
        // 生命周期状态当作空日志。
        eventCount,
        // 分叉继承的前缀属于父会话的对话，所以列表同时给出两个数字，而不是
        // 用一个数字把这部分悄悄算到子会话头上。
        ownEventCount: inherited === null ? null : Math.max(0, eventCount - inherited),
        inheritedEventCount: inherited,
        ...titleOf(session)
      }
    })
    listed.sort((a, b) => b.eventCount - a.eventCount)
    return listed
  }

  /**
   * 计量一个活跃会话并整理成面板行。
   * 错误以 { ok, code } 形状返回，客户端据此渲染三态：'unavailable'（服务
   * 未注入）、'no_live_session'（已结束或属于另一个宿主）、'measure_failed'
   * （measure() 在损坏的日志上抛出）。
   */
  async function measure(sessionId) {
    if (!ready) return { ok: false, code: 'unavailable' }
    const session = sessions.get(sessionId)
    if (!session) return { ok: false, code: 'no_live_session' }
    // measure() 在日志损坏和 step 事件不匹配时抛出——只读面板应把它报告为
    // 单个会话失败，而不是 500。整理行读取同一份计量结果，所以放在同一个
    // 围栏里：格式错误的节点列表属于同一类失败，不能让异常逃逸。
    try {
      const m = meter.measure(session)
      await loadTitles([session])
      // 持久化日志只读一次并向下传递：整理行需要它做逐节点关联和分叉切分，
      // 查询服务作答之后，两者都不应再使用已弃用的同步读取。
      const log = await readDurableLog(session)
      return {
        ok: true,
        sessionId,
        ...titleOf(session),
        measurement: shapeMeasurement(m, session, log),
        projections: readProjectionOverview(projections, session)
      }
    } catch (e) {
      return { ok: false, code: 'measure_failed', error: String((e && e.message) || e) }
    }
  }

  /**
   * 所有活跃会话中最重的节点——面板的跨会话形式，逐会话看不出的问题在这里
   * 能得到回答。
   *
   * 不并入 listSessions：它会计量每个活跃会话，成本因此保持为按需触发，
   * 不会落到下拉列表上。
   */
  async function top(limit) {
    if (!ready) return { ok: false, code: 'unavailable' }
    const live = sessions.list()
    await loadTitles(live)
    const entries = []
    const failures = []
    for (const session of live) {
      let measurement
      try {
        // 整理行放在围栏内：格式错误的计量结果与损坏日志属于同一类失败，
        // 两者都不能掩盖宿主上的其余会话。
        const log = await readDurableLog(session)
        measurement = shapeMeasurement(meter.measure(session), session, log)
      } catch (e) {
        // 一个损坏的日志不能掩盖宿主上的其余会话。
        failures.push({ sessionId: session.id, error: String((e && e.message) || e) })
        continue
      }
      entries.push({
        sessionId: session.id,
        ...titleOf(session),
        surfaceTokens: measurement.surfaceTokens,
        nodeCount: measurement.nodeCount,
        shadowPricing: measurement.shadowPricing,
        rows: measurement.rows.slice(0, limit)
      })
    }
    // 按每个会话承载的最重条目排序。
    const heaviest = (entry) => (entry.rows.length && entry.rows[0].tokens !== null ? entry.rows[0].tokens : -1)
    entries.sort((a, b) => heaviest(b) - heaviest(a) || a.sessionId.localeCompare(b.sessionId))
    return { ok: true, limit, sessions: entries, failedCount: failures.length, failures }
  }

  /**
   * 没有活跃 Agent 的已存储会话，附带投影缓存已经折算好的 token 数字。
   *
   * token 数字来自缓存而不是日志读取，所以一行的新鲜度截至该会话最后一次
   * 写入——对一个用户正在浏览的列表来说，这个取舍比一个即将据以行动的数字
   * 更合适。标题是缓存回答不了的一列，来自下面的批量观察。
   *
   * 按存储字节数降序：这个列表回答的是哪些会话占着磁盘，从未在本进程运行
   * 过的会话，本宿主没有比自身大小更可信的排序依据。
   */
  async function coldSessions() {
    if (!ready || !persistence || typeof persistence.list !== 'function') {
      return { availability: 'unavailable', sessions: [] }
    }
    let stored
    try {
      stored = await persistence.list()
    } catch {
      // 后端无法列表不是让活跃面板失败的理由，但存储部分必须报告读不到：
      // 空列表是关于数据目录的陈述，这里不是。
      return { availability: 'unavailable', sessions: [] }
    }
    if (!Array.isArray(stored) || stored.length === 0) return { availability: 'available', sessions: [] }
    const liveIds = new Set(sessions.list().map((session) => String(session.id)))
    const kept = []
    for (const snapshot of stored) {
      const header = snapshot && snapshot.header
      if (!header || typeof header.id !== 'string') continue
      // 活跃会话在面板里已有自己的条目；再列一次会把同一段对话报告成
      // 两个会话。
      if (liveIds.has(header.id)) continue
      kept.push({ snapshot, header, sessionId: header.id })
    }
    // 整个列表用一次批量标题观察，而不是每行读一次：已存储会话没有 Session
    // 对象，日志里的标题只能通过查询服务取得。
    const titles = await readTitles(kept.map((entry) => entry.sessionId))
    const rows = kept.map(({ snapshot, header, sessionId }) => {
      const title = titles === null ? undefined : titles.get(sessionId)
      return {
        sessionId,
        ...(title !== undefined ? { title, titleSource: 'title' } : fallbackTitle(sessionId, header)),
        sizeBytes: sizeBytesOf(snapshot),
        eventCount: eventCountOfSnapshot(snapshot),
        revision: Number.isInteger(snapshot.revision) && snapshot.revision >= 0 ? snapshot.revision : null,
        projections: cachedProjectionOverview(projectionCache, header)
      }
    })
    rows.sort((a, b) => compareDesc(a.sizeBytes, b.sizeBytes) || compareDesc(a.eventCount, b.eventCount) || a.sessionId.localeCompare(b.sessionId))
    return { availability: 'available', sessions: rows }
  }

  return { availability, listSessions, measure, top, coldSessions }
}

/** 后端报告时，返回存储产物的字节数。 */
function sizeBytesOf(snapshot) {
  const bytes = snapshot && snapshot.sizeBytes
  return Number.isInteger(bytes) && bytes >= 0 ? bytes : null
}

/** 已存储日志长度；无法低成本统计的后端会省略该字段。 */
function eventCountOfSnapshot(snapshot) {
  const count = snapshot && snapshot.eventCount
  return Number.isInteger(count) && count >= 0 ? count : null
}

/**
 * 比较两个可选数字，最大在前，未知最后。
 *
 * 后端没有报告大小不等于大小为零，所以也不能按零排序：`null - null` 是 0，
 * 会把顺序交给运气。
 */
function compareDesc(left, right) {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

/**
 * 为已存储会话折算 token 数字，使用与活跃路径相同的转换器，所以格式错误的
 * 缓存值与活跃会话一样退化为 `null`。缓存没有该会话的行，或头部生命周期
 * 不匹配时，不返回任何概览。
 */
export function cachedProjectionOverview(cache, header) {
  if (!cache || typeof cache.cachedSnapshot !== 'function' || !header) return null
  try {
    const snapshot = cache.cachedSnapshot(header, COLD_PROJECTION_KEYS)
    return projectionOverview(snapshot && snapshot.values)
  } catch {
    return null
  }
}

/**
 * 扫描整份事件日志的派生结果缓存，按会话存放。
 *
 * 每次刷新下拉列表都会为每个活跃会话索取标题，`measure` 还要工具名映射，
 * 两者都来自完整日志。core/session 保证 seq 连续且只追加，所以事件数量是
 * 一个可靠的修订号：日志没有增长，由它派生的结果就没有变化。
 *
 * 每个会话为每种派生结果保留一个槽位——共用一个槽位会把上一次派生结果交给
 * 调用方。这里只缓存这些小型派生结果，日志观察值从不存放在此。
 */
const derived = new WeakMap()

function memoizable(session) {
  return !!session && (typeof session === 'object' || typeof session === 'function')
}

/** 旧版的纯 `events` 数组，存在于仍携带它的宿主与测试夹具上。 */
function legacyEvents(session) {
  return Array.isArray(session && session.events) ? session.events : []
}

/** 不触碰已移除的 `events` 属性来得到日志长度。 */
export function eventCountOf(session) {
  if (Number.isInteger(session && session.seq) && session.seq >= 0) return session.seq
  return legacyEvents(session).length
}

/**
 * 分叉继承的前缀长度。
 *
 * 分叉会话的持久化日志以父会话已经写下的前缀开头，按整份日志计数会把父
 * 会话的对话算到子会话头上。`Session.inheritedEventCount` 是公开的会话状态，
 * 也是唯一的精确来源；头部只记录是否存在这样一段前缀，所以这里读取它，
 * 不从 `isSeeded` 推断。
 */
export function inheritedEventCountOf(session) {
  const inherited = session && session.inheritedEventCount
  return Number.isInteger(inherited) && inherited >= 0 ? inherited : null
}

function derivedRead(session, key) {
  if (!memoizable(session)) return undefined
  const slots = derived.get(session)
  if (!slots || slots.revision !== eventCountOf(session)) return undefined
  return slots.values.get(key)
}

function derivedWrite(session, key, value) {
  if (!memoizable(session)) return value
  const revision = eventCountOf(session)
  let slots = derived.get(session)
  if (!slots || slots.revision !== revision) {
    slots = { revision, values: new Map() }
    derived.set(session, slots)
  }
  slots.values.set(key, value)
  return value
}

function derive(session, key, compute) {
  const cached = derivedRead(session, key)
  return cached === undefined ? derivedWrite(session, key, compute()) : cached
}

/**
 * 持久化 Session 没有标题字段（core/session 的 SessionHeader 只有
 * version/id/createdAt/cwd/parentSession/isSeeded/delegationDepth/
 * agentPreset/origin）。标题是 session-title 插件写入的 `session/title`
 * 日志事件，以最后一条为准。
 *
 * 这是调用方已持有日志时的同步答案——旧版宿主或测试夹具。挂载了
 * `sessionQuery` 的宿主，活跃路径改用 `readTitleSnapshots` 读取同一个标题，
 * 那是唯一不复制日志就能读到运行中会话日志的方式。
 */
export function resolveSessionTitle(session) {
  return derive(session, 'title', () => lastTitleEvent(legacyEvents(session)) || fallbackTitle(session && session.id, session && session.header))
}

/** 日志中最后一条非空 `session/title` 载荷，没有则返回 null。 */
function lastTitleEvent(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (!event || event.type !== 'session/title') continue
    const data = event.data
    if (data && typeof data.title === 'string' && data.title.trim() !== '') {
      return { title: data.title.trim(), titleSource: 'title' }
    }
  }
  return null
}

/**
 * Web UI 在持久化标题之下的回退链：工作区目录名，然后原始 id。活跃路径与
 * 存储路径共用，区别只在于 cwd 来自 `Session` 还是解码后的头部。
 */
function fallbackTitle(sessionId, header) {
  const base = workspaceBasename(header && header.cwd)
  if (base) return { title: base, titleSource: 'cwd' }
  return { title: String(sessionId === undefined || sessionId === null ? '' : sessionId), titleSource: 'id' }
}

/** cwd 的最后一段，兼容 POSIX 与 Windows 分隔符。 */
export function workspaceBasename(cwd) {
  if (typeof cwd !== 'string') return ''
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const base = index < 0 ? trimmed : trimmed.slice(index + 1)
  // 'C:' 与 '' 是根，不是名字：交给调用方回退到 id。
  if (base === '' || /^[a-zA-Z]:$/.test(base)) return ''
  return base
}

/**
 * 把 TokenMeasurement 整理成面板行：最重的在前，每行关联持久化事件的
 * type/time/preview，并显式给出路由价与启发式影子价之间的差值。
 *
 * `log` 是查询服务作答时经过校验的观察值，否则缺席。两者的索引方式不同是
 * 有意的：查询观察值是分离的副本，节点按各事件自己的 seq 查找；旧版
 * `events` 数组本身就按 seq 索引。
 */
export function shapeMeasurement(m, session, log) {
  const events = log ? log.events : legacyEvents(session)
  const bySeq = log ? new Map(events.map((event) => [event.seq, event])) : null
  const eventAtSeq = (seq) => (bySeq ? bySeq.get(seq) : events[seq])
  const toolNames = derive(session, 'toolNames', () => buildToolNameMap(events))
  const rows = m.nodes.map((node) => {
    const event = eventAtSeq(node.seq)
    const price = Number(node.tokens)
    // 价格缺席或不是数字，不等于测得的 0：0 是宿主真实报告过的价格。用 null
    // 承载可以把它排除在所有合计之外，`fmt` 会把它显示为破折号。
    const tokens = Number.isFinite(price) ? price : null
    // 宿主没有按路由定价的节点不带影子价。把缺席字段强制成 0 会把每一行都
    // 报告为路由定价且 delta === tokens，那是捏造的信号，不是计量结果。
    const shadow = Number(node.heuristicTokens)
    const priced = Number.isFinite(shadow)
    const comparable = priced && tokens !== null
    return {
      seq: node.seq,
      tokens,
      heuristicTokens: priced ? shadow : null,
      priceDelta: comparable ? tokens - shadow : null,
      // 路由适配器只在节点声明了图片定价时重新定价，所以任何非零差值都是
      // 真实信号，不是舍入噪声。
      routePriced: comparable ? tokens !== shadow : null,
      type: event ? event.type : null,
      time: event ? event.time : null,
      surfaceOp: event ? surfaceOpKind(event) : null,
      preview: event ? extractPreview(event, toolNames) : null
    }
  })
  // 最重的在前：面板的全部意义就是找出可以卸下的压舱物。没有价格的行排在
  // 最后，比较器不能对 null 做减法——返回 NaN 会让排序顺序未定义。
  const weight = (row) => (row.tokens === null ? -1 : row.tokens)
  rows.sort((a, b) => weight(b) - weight(a) || a.seq - b.seq)
  const pricedRows = rows.reduce((n, row) => n + (row.heuristicTokens === null ? 0 : 1), 0)
  return {
    logRevision: m.logRevision,
    baseline: m.baseline,
    surfaceDeltaTokens: m.surfaceDeltaTokens,
    totalTokens: m.totalTokens,
    surfaceTokens: m.surfaceTokens,
    eventCount: eventCountOf(session),
    nodeCount: m.nodes.length,
    // 从载荷推导，不依赖版本字符串：空 surface 无法区分两种宿主形状，所以
    // 报告 'unknown'。
    shadowPricing: rows.length === 0 ? 'unknown'
      : pricedRows === 0 ? 'absent'
      : pricedRows === rows.length ? 'available'
      : 'partial',
    routePricedCount: rows.reduce((n, row) => n + (row.routePriced ? 1 : 0), 0),
    unpricedCount: rows.length - rows.reduce((n, row) => n + (row.tokens === null ? 0 : 1), 0),
    byType: summarizeTypes(rows),
    rows
  }
}

/**
 * 可选的投影摘要。只有文档化的数字字段跨越路由；格式错误或不可用的投影
 * 服务退化为 `null`，不影响独立可用的逐消息计量。
 */
export function readProjectionOverview(registry, session) {
  if (!registry || typeof registry.snapshot !== 'function') return null
  try {
    const snapshot = registry.snapshot(session)
    return projectionOverview(snapshot && snapshot.values)
  } catch {
    return null
  }
}

/**
 * 三个文档化的投影数字；一个都读不到时返回 null。活跃注册表与已存储会话
 * 缓存共用它，两条路径因此使用相同的转换器和相同的缺席规则。
 */
function projectionOverview(values) {
  const source = values && typeof values === 'object' ? values : {}
  const overview = {
    tokenUsage: tokenUsageOf(source.tokenUsage),
    contextPressure: contextPressureOf(source.contextPressure),
    contextBreakdown: contextBreakdownOf(source.contextBreakdown)
  }
  return Object.values(overview).some((value) => value !== null) ? overview : null
}

function tokenCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

function tokenUsageOf(value) {
  if (!value || typeof value !== 'object') return null
  const keys = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
  const entries = keys.map((key) => [key, tokenCount(value[key])])
  return entries.every(([, count]) => count !== null) ? Object.fromEntries(entries) : null
}

function contextPressureOf(value) {
  if (!value || typeof value !== 'object') return null
  const output = {}
  for (const key of ['pressureTokens', 'projectedTokens', 'contextWindow']) {
    const count = tokenCount(value[key])
    if (count !== null && (key !== 'contextWindow' || count > 0)) output[key] = count
  }
  return Object.keys(output).length ? output : null
}

function contextBreakdownOf(value) {
  if (!value || typeof value !== 'object') return null
  const keys = ['systemTokens', 'toolsTokens', 'messageTokens']
  const entries = keys.map((key) => [key, tokenCount(value[key])])
  return entries.every(([, count]) => count !== null) ? Object.fromEntries(entries) : null
}

/**
 * 计量后 surface 的按类型占比，在宿主侧聚合：规则只写一次，而它依赖的
 * 有值/零值界限只存在于边界这一侧。
 *
 * `total` 是所有带数字的行的合计，占比以它为分母——刻意不用
 * `surfaceTokens`，面板不能悄悄按宿主数字重新归一化。
 */
export function summarizeTypes(rows) {
  const groups = new Map()
  let total = 0
  for (const row of rows) {
    const key = row.type === null ? 'unknown' : row.type
    let group = groups.get(key)
    if (!group) {
      group = { type: row.type, count: 0, tokens: 0 }
      groups.set(key, group)
    }
    group.count += 1
    if (row.tokens !== null) {
      group.tokens += row.tokens
      total += row.tokens
    }
  }
  const types = Array.from(groups.values())
    .map((group) => ({ ...group, share: total > 0 ? group.tokens / total : 0 }))
    .sort((a, b) => b.tokens - a.tokens || b.count - a.count || String(a.type).localeCompare(String(b.type)))
  return { total, types }
}
