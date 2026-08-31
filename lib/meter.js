// dsh-ballast meter bridge.
//
// Joins ctx.tokenMeter (per-message route pricing) with ctx.sessions (live
// session lookup). Both services are core, but the handoff rule stands:
// methods that reach into ctx services are bound inside the ctx.inject
// fence, the dsh-treekeeper/lib/ledger.js pattern — a host half must not
// destructure ctx services at apply() time.
//
// Granularity contract (verified against deepseek-harness @ dsh-v0.1.2-alpha.2):
//   - ctx.tokenMeter.measure(session) returns a TokenMeasurement:
//     { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens,
//       nodes: [{ seq, tokens, heuristicTokens }] }
//   - measure() is host-only: token-meter's ./client export never carries
//     TokenMeter/TokenMeasurement/measure. DOM plugins cannot replicate this —
//     that is the moat.
//   - session.events is dense with seq === index (core/session/src/index.ts
//     enforces contiguous seqs from 0), so events[node.seq] is the right
//     lookup. nodes[] is the *current* surface, so nodes index !== seq.
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
  let ready = false
  const waiters = []

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
    for (const wake of waiters.splice(0)) wake()
  })

  function availability() {
    return ready ? 'available' : 'unavailable'
  }

  /** Live sessions usable for measurement, newest first. */
  function listSessions() {
    if (!ready) return []
    const listed = sessions.list().map((session) => ({
      sessionId: session.id,
      eventCount: session.events.length,
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
      measurement: shapeMeasurement(m, session)
    }
  }

  return { availability, listSessions, measure }
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
  const events = session && session.events
  if (Array.isArray(events)) {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (!event || event.type !== 'session/title') continue
      const data = event.data
      if (data && typeof data.title === 'string' && data.title.trim() !== '') {
        return { title: data.title.trim(), titleSource: 'title' }
      }
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
  const events = session.events
  const toolNames = buildToolNameMap(events)
  const rows = m.nodes.map((node) => {
    const event = events[node.seq]
    const tokens = Number(node.tokens) || 0
    const heuristicTokens = Number(node.heuristicTokens) || 0
    return {
      seq: node.seq,
      tokens,
      heuristicTokens,
      priceDelta: tokens - heuristicTokens,
      // A routed adapter only reprices a node when it declares image pricing;
      // any non-zero spread is therefore a real signal, not rounding noise.
      routePriced: tokens !== heuristicTokens,
      type: event ? event.type : null,
      time: event ? event.time : null,
      surfaceOp: event ? surfaceOpKind(event) : null,
      preview: event ? extractPreview(event, toolNames) : null
    }
  })
  // Heaviest first: the panel's whole point is finding the ballast to drop.
  rows.sort((a, b) => b.tokens - a.tokens)
  return {
    logRevision: m.logRevision,
    baseline: m.baseline,
    surfaceDeltaTokens: m.surfaceDeltaTokens,
    totalTokens: m.totalTokens,
    surfaceTokens: m.surfaceTokens,
    eventCount: events.length,
    nodeCount: m.nodes.length,
    routePricedCount: rows.reduce((n, row) => n + (row.routePriced ? 1 : 0), 0),
    rows
  }
}
