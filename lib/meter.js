// dsh-ballast meter bridge.
//
// Joins ctx.tokenMeter (per-message route pricing) with ctx.sessions (live
// session lookup). Both services are core, but the handoff rule stands:
// methods that reach into ctx services are bound inside the ctx.inject
// fence, the dsh-treekeeper/lib/ledger.js pattern — a host half must not
// destructure ctx services at apply() time.
//
// Granularity contract (verified against deepseek-harness @ dsh-v0.1.2-rc.1,
// with capability fallbacks kept for the declared alpha.2 minimum):
//   - ctx.tokenMeter.measure(session) returns a TokenMeasurement:
//     { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens,
//       nodes: [{ seq, tokens, heuristicTokens }] }
//   - measure() is host-only: token-meter's ./client export never carries
//     TokenMeter/TokenMeasurement/measure. DOM plugins cannot replicate this —
//     that is the moat.
//   - RC1 reads the durable log through seq/eventAt()/snapshotEvents(); alpha.2
//     exposed the same dense log as session.events. In either shape seq is the
//     event index, while nodes[] is the *current* surface, so nodes index !==
//     seq.
//   - nodes[] is already the live surface: an 'append' event later collapsed by
//     a compaction 'replace' is absent. Do not rebuild the surface from
//     events.filter(e => e.surfaceOp) — that would show shadowed rows.

import { buildToolNameMap, extractPreview, surfaceOpKind } from './preview.js'

/**
 * Build the measurement bridge. Availability flips to 'available' only once
 * both injected services are live.
 */
export function createMeterBridge(ctx) {
  let meter = null
  let sessions = null
  let projections = null
  let ready = false

  // cordis applies the callback as a plugin: it receives the derived *scope*,
  // and services hang off that scope (scope.tokenMeter) rather than arriving as
  // positional arguments. Reading them off the second parameter silently yields
  // undefined and the read-only routes crash against a live host.
  ctx.inject(['tokenMeter', 'sessions'], (scope) => {
    const candidateMeter = scope.tokenMeter
    const candidateSessions = scope.sessions
    if (!candidateMeter || !candidateSessions) return
    meter = candidateMeter
    sessions = candidateSessions
    ready = true
  })

  // Optional in the declared alpha.2 range. Keep this separate from the
  // required meter/sessions fence: making one absent enhancement part of that
  // fence would take the core panel offline on an otherwise supported host.
  ctx.inject(['sessionProjections'], (scope) => {
    if (scope.sessionProjections) projections = scope.sessionProjections
  })

  function availability() {
    return ready ? 'available' : 'unavailable'
  }

  /** Live sessions, biggest log first. */
  function listSessions() {
    if (!ready) return []
    const listed = sessions.list().map((session) => ({
      sessionId: session.id,
      // A freshly created session can be visible before its event log is
      // initialized (DSH alpha). Treat that lifecycle state as an empty log.
      eventCount: eventCountOf(session),
      ...resolveSessionTitle(session)
    }))
    listed.sort((a, b) => b.eventCount - a.eventCount)
    return listed
  }

  /**
   * Measure one live session and shape rows for the panel.
   * Returns { ok, code } shaped errors so the client can render a tri-state:
   * 'unavailable' (services not injected), 'no_live_session' (ended, or belongs
   * to another host), 'measure_failed' (measure() threw on a corrupt log).
   */
  function measure(sessionId) {
    if (!ready) return { ok: false, code: 'unavailable' }
    const session = sessions.get(sessionId)
    if (!session) return { ok: false, code: 'no_live_session' }
    // measure() throws on log corruption and mismatched step events
    // (token-meter/src/index.ts:236,245,262,310-325) — a read-only panel must
    // report that as one failed session, not as a 500.
    let m
    try {
      m = meter.measure(session)
    } catch (e) {
      return { ok: false, code: 'measure_failed', error: String((e && e.message) || e) }
    }
    return {
      ok: true,
      sessionId,
      ...resolveSessionTitle(session),
      measurement: shapeMeasurement(m, session),
      projections: readProjectionOverview(projections, session)
    }
  }

  /**
   * Heaviest nodes across every live session — the host-wide form of the
   * panel's question, which one session at a time cannot answer.
   *
   * Deliberately not folded into listSessions: this measures every live
   * session, so the cost stays opt-in instead of landing on the dropdown.
   */
  function top(limit) {
    if (!ready) return { ok: false, code: 'unavailable' }
    const entries = []
    const failures = []
    for (const session of sessions.list()) {
      let m
      try {
        m = meter.measure(session)
      } catch (e) {
        // One corrupt log must not hide the rest of the host.
        failures.push({ sessionId: session.id, error: String((e && e.message) || e) })
        continue
      }
      const measurement = shapeMeasurement(m, session)
      entries.push({
        sessionId: session.id,
        ...resolveSessionTitle(session),
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

  return { availability, listSessions, measure, top }
}

/**
 * Per-session memo for work that scans the whole event log.
 *
 * `listSessions` used to rescan every live session's log on every dropdown
 * refresh, and `measure` rebuilt the tool-name map over the same log again.
 * core/session enforces contiguous, append-only seqs, so the event count is a
 * sound revision: if the log did not grow, nothing derived from it changed.
 *
 * Each session keeps one slot per named derivation — sharing a single slot
 * would hand the caller the previous derivation's value instead.
 */
const derived = new WeakMap()

function legacyEvents(session) {
  return Array.isArray(session && session.events) ? session.events : []
}

/** Durable log length without touching RC1's removed `events` property. */
export function eventCountOf(session) {
  if (Number.isInteger(session && session.seq) && session.seq >= 0) return session.seq
  return legacyEvents(session).length
}

/** Read one durable event; modern hosts avoid copying the complete log. */
export function sessionEventAt(session, seq) {
  if (session && typeof session.eventAt === 'function') return session.eventAt(seq)
  return legacyEvents(session)[seq]
}

/** Stable full-log view for derivations that genuinely require a scan. */
export function snapshotSessionEvents(session) {
  if (session && typeof session.snapshotEvents === 'function') {
    const events = session.snapshotEvents()
    return Array.isArray(events) ? events : []
  }
  return legacyEvents(session)
}

function derive(session, key, compute) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function')) return compute()
  const revision = eventCountOf(session)
  let slots = derived.get(session)
  if (!slots || slots.revision !== revision) {
    slots = { revision, values: new Map() }
    derived.set(session, slots)
  }
  if (slots.values.has(key)) return slots.values.get(key)
  const value = compute()
  slots.values.set(key, value)
  return value
}

/**
 * A durable Session carries no title field (core/session SessionHeader has
 * only version/id/createdAt/cwd/parentSession/seedLength/origin/
 * delegationDepth/agentPreset). Titles are `session/title` log events written
 * by the session-title plugin, last one wins. Replicates the web UI's
 * displayTitleOf fallback chain: durable title, then workspace basename, then
 * the raw id.
 *
 * ctx.sessionTitle is a `seam`-classified service that may not be mounted at
 * all, so it is read from the event log instead — never from ctx.inject, which
 * would simply never fire when the service is absent.
 */
export function resolveSessionTitle(session) {
  return derive(session, 'title', () => computeSessionTitle(session))
}

function computeSessionTitle(session) {
  const events = snapshotSessionEvents(session)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (!event || event.type !== 'session/title') continue
    const data = event.data
    if (data && typeof data.title === 'string' && data.title.trim() !== '') {
      return { title: data.title.trim(), titleSource: 'title' }
    }
  }
  const cwd = session && session.header && session.header.cwd
  const base = workspaceBasename(cwd)
  if (base) return { title: base, titleSource: 'cwd' }
  return { title: String(session ? session.id : ''), titleSource: 'id' }
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
 */
export function shapeMeasurement(m, session) {
  const events = snapshotSessionEvents(session)
  const toolNames = derive(session, 'toolNames', () => buildToolNameMap(events))
  const rows = m.nodes.map((node) => {
    const event = sessionEventAt(session, node.seq)
    const price = Number(node.tokens)
    // An absent or non-numeric price is not a measured 0: 0 is a price this host
    // has really reported. Carrying it as null keeps it out of every sum, and
    // `fmt` renders it as an em dash.
    const tokens = Number.isFinite(price) ? price : null
    // Hosts before 0.1.2-alpha.2 do not emit the shadow price at all. Coercing
    // the absent field to 0 would report every row as route-priced with
    // delta === tokens, which is a fabricated signal rather than a measurement.
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
