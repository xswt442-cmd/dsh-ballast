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
//   - measure() is host-only: token-meter's ./client export is types only.
//     DOM plugins cannot replicate this — that is the moat.
//   - session.events[seq] maps a node back to its durable event
//     ({ type, seq, time, data, surfaceOp? }); surface types are
//     'user/message' | 'assistant/message' | 'tool/result'.

/**
 * Build the measurement bridge. Availability flips to 'available' only once
 * both injected services are live.
 */
export function createMeterBridge(ctx) {
  let meter = null
  let sessions = null
  let ready = false
  const waiters = []

  ctx.inject(['tokenMeter', 'sessions'], (tokenMeter, sessionsService) => {
    meter = tokenMeter
    sessions = sessionsService
    ready = true
    for (const wake of waiters.splice(0)) wake()
  })

  function availability() {
    return ready ? 'available' : 'unavailable'
  }

  /** Live sessions usable for measurement, newest first. */
  function listSessions() {
    if (!ready) return []
    return sessions.list().map((session) => ({
      sessionId: session.id,
      eventCount: session.events.length
    }))
  }

  /**
   * Measure one live session and shape rows for the panel.
   * Returns { ok, code } shaped errors for 'no_live_session' (the session
   * ended or belongs to another host) so the client can render a tri-state.
   */
  function measure(sessionId) {
    if (!ready) return { ok: false, code: 'unavailable' }
    const session = sessions.get(sessionId)
    if (!session) return { ok: false, code: 'no_live_session' }
    const m = meter.measure(session)
    return {
      ok: true,
      sessionId,
      measurement: shapeMeasurement(m, session)
    }
  }

  return { availability, listSessions, measure }
}

/**
 * Shape a TokenMeasurement into panel rows. Content previews are an M1
 * item: event.data shapes vary per event type, so the skeleton only carries
 * the durable type/time per seq and leaves text extraction to a dedicated,
 * per-type-tested pass.
 */
export function shapeMeasurement(m, session) {
  const events = session.events
  const rows = m.nodes.map((node) => {
    const event = events[node.seq]
    return {
      seq: node.seq,
      tokens: node.tokens,
      heuristicTokens: node.heuristicTokens,
      type: event ? event.type : null,
      time: event ? event.time : null
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
    rows
  }
}
