// dsh-ballast meter bridge.
//
// Joins ctx.tokenMeter (per-message route pricing) with ctx.sessions (live
// session lookup). Both services are core, but the handoff rule stands:
// methods that reach into ctx services are bound inside the ctx.inject
// fence, not destructured at apply() time — the fence is what makes the
// services' lifetime span the binding.
//
// Granularity contract (verified against deepseek-harness @ dsh-v0.1.2-rc.1):
//   - ctx.tokenMeter.measure(session) returns a TokenMeasurement:
//     { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens,
//       nodes: [{ seq, tokens, heuristicTokens }] }
//   - measure() is host-only: token-meter's ./client export never carries
//     TokenMeter/TokenMeasurement/measure. DOM plugins cannot replicate this —
//     that is the moat.
//   - nodes[] is already the live surface: an 'append' event later collapsed by
//     a compaction 'replace' is absent. Do not rebuild the surface from
//     events.filter(e => e.surfaceOp) — that would show shadowed rows.
//   - nodes[] indexes the current surface, not the raw log: `seq` is the seq of
//     the event that added the node, while a compaction that collapses a surface
//     range leaves the surviving entries pointing at the seqs that created them.
//   - measure() prices the complete log, inherited prefix included, so a forked
//     session reports its parent's conversation under its own name. The cut is
//     Session.inheritedEventCount, and the shape below splits the totals on it.
//
// Durable-log reads go through ctx.sessionQuery. Session.eventAt() and
// Session.snapshotEvents() are deprecated — synchronously reading an arbitrary
// position ties the consumer to the complete sequence staying resident, which
// the storage direction removes — so the query service is the supported read and
// every bridge method that needs one is asynchronous. The two figures that are
// plain session state stay synchronous: Session.seq for the log length and
// Session.inheritedEventCount for the fork-inherited prefix.
//
// The query service is optional. Without it the panel still answers from the
// legacy `events` array where one is present, and reports the fields that only a
// log read can produce as absent — never as a guess. coldSessions() has no
// synchronous counterpart at all, because a stored session has no Session object
// to read from.

import { buildToolNameMap, extractPreview, surfaceOpKind } from './preview.js'

/** Projection keys whose cached values the panel reads for a stored session. */
export const COLD_PROJECTION_KEYS = ['tokenUsage', 'contextPressure', 'contextBreakdown']

/**
 * Build the measurement bridge. Availability flips to 'available' only once
 * both injected services are live.
 */
export function createMeterBridge(ctx) {
  let meter = null
  let sessions = null
  let projections = null
  let query = null
  let persistence = null
  let projectionCache = null
  let ready = false

  // cordis applies the callback as a plugin: it receives the derived *scope*,
  // and services hang off that scope (scope.tokenMeter) rather than arriving as
  // positional arguments. Reading them off the second parameter silently yields
  // undefined and the read-only routes crash against a live host.
  ctx.inject(['tokenMeter', 'sessions'], (scope) => {
    const candidateMeter = scope.tokenMeter
    const candidateSessions = scope.sessions
    if (!candidateMeter || !candidateSessions) return
    // Shape-check the services before claiming readiness: a host that binds a
    // tokenMeter without measure() would otherwise flip availability() to
    // 'available' and then fail every request — a lie worse than 'unavailable'.
    if (typeof candidateMeter.measure !== 'function') return
    if (typeof candidateSessions.list !== 'function' || typeof candidateSessions.get !== 'function') return
    meter = candidateMeter
    sessions = candidateSessions
    ready = true
  })

  // Optional: a host that does not carry the projection registry still gets the
  // core panel. Keep this separate from the required meter/sessions fence —
  // making one absent enhancement part of that fence would take the core panel
  // offline on an otherwise supported host.
  ctx.inject(['sessionProjections'], (scope) => {
    if (scope.sessionProjections) projections = scope.sessionProjections
  })

  // Exact durable-log reads: `readSession` for the per-node join and
  // `readTitleSnapshots` for the batched titles. Both are checked at bind time
  // because the bridge degrades to the legacy `events` array rather than failing
  // when one of them is absent, and a half-shaped service would otherwise turn
  // every row join into a rejected promise.
  ctx.inject(['sessionQuery'], (scope) => {
    const candidate = scope.sessionQuery
    if (!candidate) return
    if (typeof candidate.readSession !== 'function') return
    if (typeof candidate.readTitleSnapshots !== 'function') return
    query = candidate
  })

  // Stored sessions, and the service that answers for one: the projection cache
  // holds figures the host already folded, so a stored row can be priced without
  // reading its log.
  ctx.inject(['sessionPersistence'], (scope) => {
    if (scope.sessionPersistence) persistence = scope.sessionPersistence
  })
  ctx.inject(['sessionProjectionCache'], (scope) => {
    if (scope.sessionProjectionCache) projectionCache = scope.sessionProjectionCache
  })

  /**
   * The durable log for one live session, or null when no query service answered.
   *
   * The returned observation is used in place and never retained on the Session:
   * memoizing it would put the complete sequence back in memory under this
   * plugin's ownership, which is the dependency `Session.snapshotEvents()` is
   * being retired for. A log the service rejects joins no rows, so the caller
   * renders the measurement without per-node types instead of failing the panel.
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
   * Durable titles for the given sessions, or null when the query service
   * cannot answer at all.
   *
   * The map carries one entry per row the service could read and name; a row it
   * could not read is simply absent, and `null` is reserved for "no service, or
   * the whole batch failed" — the caller treats the two the same way, by leaving
   * that session's title slot to the synchronous scan.
   */
  async function readTitles(sessionIds) {
    if (!query || typeof query.readTitleSnapshots !== 'function') return null
    if (sessionIds.length === 0) return new Map()
    let observations
    try {
      observations = await query.readTitleSnapshots(sessionIds)
    } catch {
      return null
    }
    if (!Array.isArray(observations)) return null
    const titles = new Map()
    for (const observation of observations) {
      // One unreadable session is that row's business: dropping it here leaves
      // the synchronous scan to answer for it, and the rest of the list keeps
      // the titles the service did fold.
      if (!observation || observation.status !== 'fulfilled') continue
      const value = observation.value
      const session = value && value.session
      const title = value && value.title && typeof value.title.title === 'string' ? value.title.title.trim() : ''
      if (session && session.id !== undefined && title !== '') titles.set(String(session.id), title)
    }
    return titles
  }

  /**
   * Fill the title memo for sessions whose log grew since the last call.
   *
   * `readTitleSnapshots` folds each title from inside the complete log, so this
   * is the one read the panel must not repeat for an unchanged session — the
   * revision memo in `derived` is what keeps a refresh of an idle host free.
   *
   * Only a title the service actually returned is memoized. With no service, and
   * for a row the batch could not read, the slot stays empty so
   * `resolveSessionTitle` answers from the log this process already holds: it
   * reaches the real title when the log carries one, and the same workspace
   * basename when it does not. Writing that fallback here instead would pin the
   * worse answer for the rest of the process.
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
   * The title for a session `loadTitles` has already covered, or the synchronous
   * scan when a caller reaches a session the load has not seen.
   */
  function titleOf(session) {
    const memoized = derivedRead(session, 'title')
    return memoized === undefined ? resolveSessionTitle(session) : memoized
  }

  function availability() {
    return ready ? 'available' : 'unavailable'
  }

  /**
   * Live sessions, biggest log first.
   *
   * Asynchronous because the durable title read is: one batched
   * `readTitleSnapshots` observation answers for every session whose log grew
   * since the last call, and the memo below makes a refresh that changed nothing
   * cost nothing.
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
        // A freshly created session can be visible before its event log is
        // initialized (DSH alpha). Treat that lifecycle state as an empty log.
        eventCount,
        // The prefix a fork inherited belongs to the parent's conversation, so
        // the list carries both figures rather than one number that silently
        // bills the child for it.
        ownEventCount: inherited === null ? null : Math.max(0, eventCount - inherited),
        inheritedEventCount: inherited,
        ...titleOf(session)
      }
    })
    listed.sort((a, b) => b.eventCount - a.eventCount)
    return listed
  }

  /**
   * Measure one live session and shape rows for the panel.
   * Returns { ok, code } shaped errors so the client can render a tri-state:
   * 'unavailable' (services not injected), 'no_live_session' (ended, or belongs
   * to another host), 'measure_failed' (measure() threw on a corrupt log).
   */
  async function measure(sessionId) {
    if (!ready) return { ok: false, code: 'unavailable' }
    const session = sessions.get(sessionId)
    if (!session) return { ok: false, code: 'no_live_session' }
    // measure() throws on log corruption and mismatched step events
    // (token-meter/src/index.ts:236,245,262,310-325) — a read-only panel must
    // report that as one failed session, not as a 500. Shaping reads the same
    // measurement, so it sits inside the same fence: a malformed node list is
    // the same class of failure and must not escape as an unhandled throw.
    try {
      const m = meter.measure(session)
      await loadTitles([session])
      // The durable log is read once and passed down: shaping needs it for the
      // per-node join and the fork-inherited cut, and neither may reach for the
      // deprecated synchronous readers once the query service has answered.
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
   * Heaviest nodes across every live session — the host-wide form of the
   * panel's question, which one session at a time cannot answer.
   *
   * Deliberately not folded into listSessions: this measures every live
   * session, so the cost stays opt-in instead of landing on the dropdown.
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
        // Shaping is inside the fence on purpose: a malformed measurement is the
        // same class of failure as a corrupt log, and neither may hide the rest
        // of the host.
        const log = await readDurableLog(session)
        measurement = shapeMeasurement(meter.measure(session), session, log)
      } catch (e) {
        // One corrupt log must not hide the rest of the host.
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
    // Ranked by the heaviest thing each session is carrying.
    const heaviest = (entry) => (entry.rows.length && entry.rows[0].tokens !== null ? entry.rows[0].tokens : -1)
    entries.sort((a, b) => heaviest(b) - heaviest(a) || a.sessionId.localeCompare(b.sessionId))
    return { ok: true, limit, sessions: entries, failedCount: failures.length, failures }
  }

  /**
   * Stored sessions with no live Agent, with the token figures the projection
   * cache has already folded for them.
   *
   * The token figures come from the cache instead of a log read, so a row is as
   * stale as that session's last write — the right trade for a listing the user
   * is scanning rather than a number they are about to act on. Titles are the one
   * column the cache cannot answer, and they come from the batched observation
   * below.
   *
   * Ordered by stored bytes, descending: the question this list answers is which
   * sessions occupy the disk, and a session that never ran in this process has
   * no activity this host could order by more truthfully than its own size.
   */
  async function coldSessions() {
    if (!ready || !persistence || typeof persistence.list !== 'function') {
      return { availability: 'unavailable', sessions: [] }
    }
    let stored
    try {
      stored = await persistence.list()
    } catch {
      // A backend that cannot list is not a reason to fail the live panel, but
      // the stored half has to report that it could not read: an empty list is a
      // statement about the data directory, and this is not one.
      return { availability: 'unavailable', sessions: [] }
    }
    if (!Array.isArray(stored) || stored.length === 0) return { availability: 'available', sessions: [] }
    const liveIds = new Set(sessions.list().map((session) => String(session.id)))
    const kept = []
    for (const snapshot of stored) {
      const header = snapshot && snapshot.header
      if (!header || typeof header.id !== 'string') continue
      // A live session already has its own panel entry; listing it twice would
      // report the same conversation as two sessions.
      if (liveIds.has(header.id)) continue
      kept.push({ snapshot, header, sessionId: header.id })
    }
    // One batched title observation for the whole list rather than one read per
    // row: a stored session has no Session object, so the log-backed title is
    // only reachable through the query service.
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

/** Stored artifact size, when the backend reports one. */
function sizeBytesOf(snapshot) {
  const bytes = snapshot && snapshot.sizeBytes
  return Number.isInteger(bytes) && bytes >= 0 ? bytes : null
}

/** Stored log length; a backend that cannot price it cheaply omits the field. */
function eventCountOfSnapshot(snapshot) {
  const count = snapshot && snapshot.eventCount
  return Number.isInteger(count) && count >= 0 ? count : null
}

/**
 * Order two optional figures, largest first and unknown last.
 *
 * A backend that reports no size is not a size of zero, so it must not sort as
 * one either: `null - null` is 0 and would leave that order to chance.
 */
function compareDesc(left, right) {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

/**
 * Folded token figures for one stored session, in the same converters the live
 * path uses, so a malformed cached value degrades to `null` here exactly as it
 * does for a live session. A cache that has no row for this session, or whose
 * header lifecycle does not match, yields no overview at all.
 */
export function cachedProjectionOverview(cache, header) {
  if (!cache || typeof cache.cachedSnapshot !== 'function' || !header) return null
  try {
    const snapshot = cache.cachedSnapshot(header, COLD_PROJECTION_KEYS)
    if (!snapshot || !snapshot.values) return null
    const overview = {
      tokenUsage: tokenUsageOf(snapshot.values.tokenUsage),
      contextPressure: contextPressureOf(snapshot.values.contextPressure),
      contextBreakdown: contextBreakdownOf(snapshot.values.contextBreakdown)
    }
    return Object.values(overview).some((value) => value !== null) ? overview : null
  } catch {
    return null
  }
}

/**
 * Per-session memo for work that scans the whole event log.
 *
 * Each dropdown refresh asks `listSessions` for every live session's title and
 * `measure` for a tool-name map, both derived from the complete log.
 * core/session enforces contiguous, append-only seqs, so the event count is a
 * sound revision: if the log did not grow, nothing derived from it changed.
 *
 * Each session keeps one slot per named derivation — sharing a single slot
 * would hand the caller the previous derivation's value instead. Only these
 * small derivations are memoized; a log observation is never stored here.
 */
const derived = new WeakMap()

function memoizable(session) {
  return !!session && (typeof session === 'object' || typeof session === 'function')
}

/** The legacy plain `events` array, on hosts and fixtures that still carry one. */
function legacyEvents(session) {
  return Array.isArray(session && session.events) ? session.events : []
}

/** Durable log length without touching RC1's removed `events` property. */
export function eventCountOf(session) {
  if (Number.isInteger(session && session.seq) && session.seq >= 0) return session.seq
  return legacyEvents(session).length
}

/**
 * The fork-inherited prefix length.
 *
 * A forked session's durable log begins with the prefix its parent had already
 * logged, so a figure that counts the whole log bills the child for its parent's
 * conversation. `Session.inheritedEventCount` is public session state and the
 * only exact source; the header records merely whether such a prefix exists,
 * which is why this is read rather than inferred from `isSeeded`.
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
 * A durable Session carries no title field (core/session SessionHeader has
 * only version/id/createdAt/cwd/parentSession/isSeeded/delegationDepth/
 * agentPreset/origin). Titles are `session/title` log events written by the
 * session-title plugin, last one wins.
 *
 * This is the synchronous answer for a log the caller already holds — a legacy
 * host, or a fixture. On a host that mounts `sessionQuery` the live path reads
 * the same title through `readTitleSnapshots` instead, which is the only read
 * that reaches a running session's log without copying it.
 */
export function resolveSessionTitle(session) {
  return derive(session, 'title', () => lastTitleEvent(legacyEvents(session)) || fallbackTitle(session && session.id, session && session.header))
}

/** The last non-blank `session/title` payload in a log, or null. */
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
 * The web UI's chain below the durable title: workspace basename, then the raw
 * id. Shared by the live and stored paths, which differ only in whether a
 * `Session` or a decoded header supplied the cwd.
 */
function fallbackTitle(sessionId, header) {
  const base = workspaceBasename(header && header.cwd)
  if (base) return { title: base, titleSource: 'cwd' }
  return { title: String(sessionId === undefined || sessionId === null ? '' : sessionId), titleSource: 'id' }
}

/** Last path segment of a cwd, for both POSIX and Windows separators. */
export function workspaceBasename(cwd) {
  if (typeof cwd !== 'string') return ''
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const base = index < 0 ? trimmed : trimmed.slice(index + 1)
  // 'C:' and '' are roots, not labels: let the caller fall back to the id.
  if (base === '' || /^[a-zA-Z]:$/.test(base)) return ''
  return base
}

/**
 * Shape a TokenMeasurement into panel rows: heaviest first, each joined to its
 * durable event for type/time/preview, and with the route-vs-heuristic spread
 * made explicit.
 *
 * `log` is the query read's validated observation when that service answered,
 * and is absent otherwise. The two are indexed differently on purpose: a query
 * observation is a detached clone, so a node's seq is looked up by the seq each
 * event reports, while the legacy `events` array is already indexed by seq.
 */
export function shapeMeasurement(m, session, log) {
  const events = log ? log.events : legacyEvents(session)
  const bySeq = log ? new Map(events.map((event) => [event.seq, event])) : null
  const eventAtSeq = (seq) => (bySeq ? bySeq.get(seq) : events[seq])
  const toolNames = derive(session, 'toolNames', () => buildToolNameMap(events))
  const rows = m.nodes.map((node) => {
    const event = eventAtSeq(node.seq)
    const price = Number(node.tokens)
    // An absent or non-numeric price is not a measured 0: 0 is a price this host
    // has really reported. Carrying it as null keeps it out of every sum, and
    // `fmt` renders it as an em dash.
    const tokens = Number.isFinite(price) ? price : null
    // A node the host did not route-price carries no shadow price at all.
    // Coercing the absent field to 0 would report every row as route-priced
    // with delta === tokens, which is a fabricated signal rather than a
    // measurement.
    const shadow = Number(node.heuristicTokens)
    const priced = Number.isFinite(shadow)
    const comparable = priced && tokens !== null
    return {
      seq: node.seq,
      tokens,
      heuristicTokens: priced ? shadow : null,
      priceDelta: comparable ? tokens - shadow : null,
      // A routed adapter only reprices a node when it declares image pricing;
      // any non-zero spread is therefore a real signal, not rounding noise.
      routePriced: comparable ? tokens !== shadow : null,
      type: event ? event.type : null,
      time: event ? event.time : null,
      surfaceOp: event ? surfaceOpKind(event) : null,
      preview: event ? extractPreview(event, toolNames) : null
    }
  })
  // Heaviest first: the panel's whole point is finding the ballast to drop.
  // Unpriced rows sort last, and the comparator must not subtract nulls — a NaN
  // return leaves the sort order undefined.
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
    // Derived from the payload, never from a version string: an empty surface
    // cannot tell the two host shapes apart, so it reports 'unknown'.
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
 * Optional RC1 projection summary. Only documented numeric fields cross the
 * route; malformed or unavailable projection services degrade to `null`
 * without taking the independently useful per-message measurement down.
 */
export function readProjectionOverview(registry, session) {
  if (!registry || typeof registry.snapshot !== 'function') return null
  try {
    const snapshot = registry.snapshot(session)
    const values = snapshot && snapshot.values ? snapshot.values : {}
    const overview = {
      tokenUsage: tokenUsageOf(values.tokenUsage),
      contextPressure: contextPressureOf(values.contextPressure),
      contextBreakdown: contextBreakdownOf(values.contextBreakdown)
    }
    return Object.values(overview).some((value) => value !== null) ? overview : null
  } catch {
    return null
  }
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
 * Per-type share of the measured surface, aggregated here rather than in the
 * panel: the rule has to be stated once, and the null-vs-zero line it depends
 * on only exists on this side of the boundary.
 *
 * `total` is the sum over rows that carry a number, which is what the shares
 * divide by — deliberately not `surfaceTokens`, a host figure the panel must
 * not silently renormalise against.
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
