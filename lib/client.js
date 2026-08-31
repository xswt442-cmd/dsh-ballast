// dsh-ballast browser half. Classic-script client bundle, the
// dsh-instance-manager pattern: register a factory with
// window.__ModuleLoader__, React from the platform seed, data from the
// same-origin JSON endpoint /dsh-ballast/api (host half).
//
// The entry joins the small createhelper utility dock shared with
// dsh-instance-manager and dsh-treekeeper
// (window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__). Each plugin still owns its
// own panel and state.

window.__ModuleLoader__.load({
  id: 'dsh-ballast',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const DOCK_KEY = '__CREATEHELPER_DSH_UTILITY_DOCK_V1__'
    const DOCK_PROTOCOL = 'createhelper.dsh.utility-dock'
    const DOCK_VERSION = 1
    const isCompatibleDock = (value) => !!value &&
      typeof value.register === 'function' &&
      typeof value.setPlacement === 'function' &&
      typeof value.getPlacement === 'function' &&
      // Builds before the protocol metadata shipped already implemented v1.
      (value.protocol === undefined ||
        (value.protocol === DOCK_PROTOCOL && value.version === DOCK_VERSION))

    // ---- data ---------------------------------------------------------
    async function fetchJson(url) {
      const res = await fetch(url)
      const body = await res.json().catch(() => ({}))
      return { status: res.status, body }
    }

    // ---- panel --------------------------------------------------------
    function BallastPanel() {
      const [state, setState] = React.useState({
        loading: true,
        availability: 'unknown',
        sessions: [],
        selected: null,
        measure: null,
        error: null
      })

      const loadSessions = React.useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }))
        const { status, body } = await fetchJson('/dsh-ballast/api?action=sessions')
        if (!body.ok) {
          setState((s) => ({ ...s, loading: false, error: `sessions ${status}` }))
          return
        }
        setState((s) => ({
          ...s,
          loading: false,
          availability: body.availability || 'unavailable',
          sessions: body.sessions || [],
          selected: s.selected && (body.sessions || []).some((x) => x.sessionId === s.selected)
            ? s.selected
            : ((body.sessions || [])[0] || {}).sessionId || null
        }))
      }, [])

      const loadMeasure = React.useCallback(async (sessionId) => {
        if (!sessionId) return
        const { status, body } = await fetchJson(`/dsh-ballast/api?action=measure&sessionId=${encodeURIComponent(sessionId)}`)
        if (!body.ok) {
          setState((s) => ({ ...s, measure: null, error: `measure ${status}: ${body.code || ''}` }))
          return
        }
        setState((s) => ({ ...s, measure: body.measurement, error: null }))
      }, [])

      React.useEffect(() => { loadSessions() }, [loadSessions])
      React.useEffect(() => { if (state.selected) loadMeasure(state.selected) }, [state.selected, loadMeasure])

      const fmt = (n) => Number(n || 0).toLocaleString('en-US')

      const rows = state.measure ? state.measure.rows : []
      const max = rows.length ? rows[0].tokens : 0

      return h('div', { style: STYLE.root },
        h('div', { style: STYLE.header },
          h('strong', null, 'ballast'),
          h('span', { style: STYLE.sub }, '窗口被谁占了'),
          h('button', { style: STYLE.btn, onClick: () => { loadSessions(); if (state.selected) loadMeasure(state.selected) } }, '刷新')
        ),
        h('div', { style: STYLE.controls },
          h('select', {
            style: STYLE.select,
            value: state.selected || '',
            onChange: (e) => setState((s) => ({ ...s, selected: e.target.value }))
          },
            state.sessions.length === 0
              ? h('option', { value: '' }, state.loading ? '加载中…' : '无活跃会话')
              : state.sessions.map((s) => h('option', { key: s.sessionId, value: s.sessionId },
                  `#${s.sessionId} (${s.eventCount} events)`))
          )
        ),
        state.error && h('div', { style: STYLE.error }, state.error),
        state.measure && h('div', { style: STYLE.totals },
          `total ${fmt(state.measure.totalTokens)} · surface ${fmt(state.measure.surfaceTokens)} · delta ${fmt(state.measure.surfaceDeltaTokens)} · baseline ${state.measure.baseline.kind}`
        ),
        h('div', { style: STYLE.list },
          rows.map((row) => h('div', { key: row.seq, style: STYLE.row },
            h('div', { style: { ...STYLE.bar, width: max > 0 ? `${Math.max(2, (row.tokens / max) * 100)}%` : '0%' } }),
            h('div', { style: STYLE.rowText },
              h('span', { style: STYLE.seq }, `#${row.seq}`),
              h('span', { style: STYLE.type }, row.type || '(unknown)'),
              h('span', { style: STYLE.tokens }, fmt(row.tokens))
            )
          ))
        ),
        state.measure && rows.length === 0 && h('div', { style: STYLE.empty }, 'surface 为空')
      )
    }

    // ---- styles -------------------------------------------------------
    const STYLE = {
      root: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'inherit', minWidth: 280 },
      header: { display: 'flex', alignItems: 'center', gap: 8 },
      sub: { opacity: 0.55, flex: 1 },
      btn: { cursor: 'pointer', fontSize: 12 },
      controls: { display: 'flex', gap: 6 },
      select: { flex: 1, fontSize: 12, maxWidth: 240 },
      error: { color: '#e06c75', whiteSpace: 'pre-wrap' },
      totals: { opacity: 0.75 },
      list: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflowY: 'auto' },
      row: { position: 'relative', padding: '2px 4px', overflow: 'hidden', borderRadius: 3 },
      bar: { position: 'absolute', inset: 0, opacity: 0.18, background: 'currentColor' },
      rowText: { position: 'relative', display: 'flex', gap: 8 },
      seq: { opacity: 0.5, minWidth: 44 },
      type: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      tokens: { fontVariantNumeric: 'tabular-nums' },
      empty: { opacity: 0.55, padding: '6px 0' }
    }

    // ---- dock join ----------------------------------------------------
    if (isCompatibleDock(window[DOCK_KEY])) {
      window[DOCK_KEY].register({
        id: 'dsh-ballast',
        title: 'ballast',
        render: () => h(BallastPanel)
      })
    }
  }
})
