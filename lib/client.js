// dsh-ballast browser half. Classic-script client bundle, the
// dsh-instance-manager pattern: register a factory with
// window.__ModuleLoader__; React comes from the platform seed, data comes from
// the same-origin JSON endpoint /dsh-ballast/api (host half).
//
// DSH serves this file byte-for-byte (packages/client/modules readFileSync's
// exports["./client"]; no bundler runs at serve time, and the transport is a
// classic <script>, so `import` is a SyntaxError). The shared dock bootstrap is
// therefore embedded below from lib/dock.js rather than imported — and since
// that module creates the dock when none exists, ballast works standalone: no
// DIM or DTK install is needed to get an entry point.

window.__ModuleLoader__.load({
  id: 'dsh-ballast',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    // ---- shared utility dock (canonical: lib/dock.js) --------------------
    // Kept line-for-line in sync with lib/dock.js; test/dock-parity.test.js
    // fails if either side drifts.
    const DOCK_KEY = '__CREATEHELPER_DSH_UTILITY_DOCK_V1__'
    const DOCK_PROTOCOL = 'createhelper.dsh.utility-dock'
    const DOCK_VERSION = 1
    const DOCK_PLACEMENT_KEY = 'createhelper.utilityDock.placement'
    const DOCK_CSS_ID = 'createhelper-utility-dock'
    const DOCK_SNAPSHOT = 'createhelper.utility-dock/1+placement'

    const isCompatibleDock = (value) => !!value &&
      typeof value.register === 'function' &&
      typeof value.setPlacement === 'function' &&
      typeof value.getPlacement === 'function' &&
      // Builds before the protocol metadata shipped already implemented v1.
      (value.protocol === undefined ||
        (value.protocol === DOCK_PROTOCOL && value.version === DOCK_VERSION))

    /**
     * Dock chrome styles live here because the creator owns the container. Both
     * shipped plugins previously carried their own copy of these five rules, so a
     * dock created by the plugin that happens to load second still painted.
     */
    function ensureUtilityDockStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + DOCK_CSS_ID + '"]') !== null) return
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin-css', DOCK_CSS_ID)
      styleEl.textContent =
        '.createhelper-utility-dock{position:fixed;bottom:16px;z-index:9997;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 6px 22px rgba(0,0,0,.24);pointer-events:auto}' +
        '.createhelper-utility-dock[hidden]{display:none}' +
        '.createhelper-utility-dock-item{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}' +
        '.createhelper-utility-dock-item:hover,.createhelper-utility-dock-item[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}' +
        '.createhelper-utility-dock-item svg{display:block}'
      document.head.appendChild(styleEl)
    }

    function getUtilityDock() {
      if (isCompatibleDock(window[DOCK_KEY])) return window[DOCK_KEY]
      ensureUtilityDockStyles()
      const items = new Map()
      let root = null
      let resizeObserver = null
      let mutationObserver = null
      const readPlacement = () => {
        try {
          const value = localStorage.getItem(DOCK_PLACEMENT_KEY)
          if (value === 'main-bottom-right' || value === 'hidden') return value
        } catch (e) { }
        return 'main-bottom-left'
      }
      let placement = readPlacement()
      const updateGeometry = () => {
        if (!root) return
        root.hidden = placement === 'hidden'
        root.dataset.placement = placement
        document.documentElement.dataset.createhelperUtilityDockPlacement = placement
        root.style.right = ''
        root.style.left = ''
        if (placement === 'main-bottom-right') {
          root.style.right = '16px'
          return
        }
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay && overlay.parentElement
        const sidebar = frame && frame.firstElementChild
        const frameRect = frame && frame.getBoundingClientRect()
        const sidebarRect = sidebar && sidebar.getBoundingClientRect()
        const left = frameRect && sidebarRect
          ? Math.max(16, Math.round(sidebarRect.right - frameRect.left + frameRect.left + 16))
          : 80
        root.style.left = left + 'px'
        document.documentElement.style.setProperty('--createhelper-utility-dock-left', left + 'px')
      }
      const render = () => {
        if (!root) {
          root = document.createElement('nav')
          root.className = 'createhelper-utility-dock'
          root.setAttribute('aria-label', 'DSH utilities')
          document.body.appendChild(root)
          window.addEventListener('resize', updateGeometry)
          const observeLayout = () => {
            const overlay = document.querySelector('[data-shell-overlay]')
            const frame = overlay && overlay.parentElement
            if (!frame) return false
            mutationObserver?.disconnect()
            mutationObserver = null
            if (typeof ResizeObserver === 'function' && !resizeObserver) {
              resizeObserver = new ResizeObserver(updateGeometry)
              resizeObserver.observe(frame)
              if (frame.firstElementChild) resizeObserver.observe(frame.firstElementChild)
            }
            updateGeometry()
            return true
          }
          if (!observeLayout() && typeof MutationObserver === 'function') {
            mutationObserver = new MutationObserver(() => { observeLayout() })
            mutationObserver.observe(document.body, { childList: true, subtree: true })
          }
        }
        root.replaceChildren()
        Array.from(items.values()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).forEach((item) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'createhelper-utility-dock-item'
          button.dataset.createhelperDockItem = item.id
          button.title = item.label
          button.setAttribute('aria-label', item.label)
          button.setAttribute('aria-pressed', item.active ? 'true' : 'false')
          button.innerHTML = item.icon
          button.addEventListener('click', () => {
            if (!item.active) {
              for (const other of items.values()) {
                if (other.id !== item.id && other.active && typeof other.onDeactivate === 'function') {
                  other.onDeactivate()
                }
              }
            }
            item.onActivate()
          })
          root.appendChild(button)
        })
        updateGeometry()
      }
      const api = {
        protocol: DOCK_PROTOCOL,
        version: DOCK_VERSION,
        snapshot: DOCK_SNAPSHOT,
        register(item) {
          if (!item || typeof item.id !== 'string' || !item.id || typeof item.onActivate !== 'function') {
            throw new TypeError('utility dock item requires a non-empty id and onActivate()')
          }
          const registration = Object.freeze({})
          items.set(item.id, { ...item, registration, order: Number(item.order) || 0, active: !!item.active })
          render()
          return {
            update(patch) {
              const current = items.get(item.id)
              if (!current || current.registration !== registration) return
              items.set(item.id, { ...current, ...patch })
              render()
            },
            dispose() {
              const current = items.get(item.id)
              if (!current || current.registration !== registration) return
              items.delete(item.id)
              if (items.size) { render(); return }
              resizeObserver?.disconnect()
              resizeObserver = null
              mutationObserver?.disconnect()
              mutationObserver = null
              window.removeEventListener('resize', updateGeometry)
              root?.remove()
              root = null
            }
          }
        },
        setPlacement(next) {
          placement = next === 'main-bottom-right' || next === 'hidden' ? next : 'main-bottom-left'
          try { localStorage.setItem(DOCK_PLACEMENT_KEY, placement) } catch (e) { }
          updateGeometry()
        },
        getPlacement() { return placement }
      }
      window[DOCK_KEY] = api
      return api
    }

    // ---- plugin css ------------------------------------------------------
    const CSS_ID = 'dsh-ballast'
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') !== null) return
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin-css', CSS_ID)
      styleEl.textContent =
        '.dshbl-layer{position:fixed;top:64px;right:16px;width:520px;max-width:calc(100vw - 32px);max-height:min(680px,78vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:9999;pointer-events:auto;font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden}' +
        '.dshbl-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}' +
        '.dshbl-title{margin:0;font-size:14px;font-weight:600}' +
        '.dshbl-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-spacer{flex:1}' +
        '.dshbl-count{font-size:11px;line-height:17px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}' +
        '.dshbtn{display:flex;align-items:center;gap:6px;padding:6px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;cursor:pointer;font:inherit;white-space:nowrap}' +
        '.dshbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}' +
        '.dshbl-body{overflow:auto;padding:6px 8px}' +
        '.dshbl-controls{display:flex;align-items:center;gap:6px;padding:2px 6px 8px}' +
        '.dshbl-select{flex:1;min-width:0;font:inherit;font-size:12px;padding:4px 6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit}' +
        '.dshbl-totals{display:flex;flex-wrap:wrap;gap:10px;padding:0 10px 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-total-strong{color:var(--dsw-alias-label-primary);font-weight:600}' +
        '.dshbl-error{margin:0 10px 8px;padding:8px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:12px;white-space:pre-wrap}' +
        '.dshbl-row{position:relative;display:flex;align-items:baseline;gap:8px;padding:5px 10px;border-radius:9px;overflow:hidden}' +
        '.dshbl-row:hover{background:var(--dsw-alias-bg-layer-2)}' +
        '.dshbl-bar{position:absolute;left:0;top:0;bottom:0;opacity:.14;background:currentColor;pointer-events:none}' +
        '.dshbl-seq{position:relative;min-width:38px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}' +
        '.dshbl-type{position:relative;min-width:46px;font-size:11px;color:var(--dsw-alias-brand-primary)}' +
        '.dshbl-text{position:relative;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.dshbl-tokens{position:relative;font-variant-numeric:tabular-nums;font-weight:600}' +
        '.dshbl-meta{position:relative;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}' +
        '.dshbl-spread{color:var(--dsw-alias-state-warn-primary)}' +
        '.dshbl-tag{font-size:10.5px;line-height:15px;padding:0 5px;border-radius:999px;border:1px solid currentColor;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-tag-warn{color:var(--dsw-alias-state-warn-primary)}' +
        '.dshbl-foot{padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;flex:none}' +
        '.dshbl-empty{padding:14px 10px;color:var(--dsw-alias-label-secondary)}'
      document.head.appendChild(styleEl)
    }

    // ---- open state ------------------------------------------------------
    const BALLAST_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M6 12h12M9 19h6"></path></svg>'

    const openStore = { open: false, listeners: new Set() }
    let dockItem = null
    const setOpen = (value) => {
      openStore.open = !!value
      openStore.listeners.forEach((listener) => listener())
      dockItem?.update({ active: openStore.open })
    }
    const useOpen = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1)
        openStore.listeners.add(listener)
        return () => openStore.listeners.delete(listener)
      }, [])
      return openStore.open
    }

    // ---- view helpers ----------------------------------------------------
    const fmt = (n) => Number(n || 0).toLocaleString('en-US')

    const TYPE_LABEL = {
      'user/message': '用户',
      'assistant/message': '助手',
      'tool/result': '工具'
    }

    function typeLabel(row) {
      if (row.type && TYPE_LABEL[row.type]) return TYPE_LABEL[row.type]
      return row.type || '?'
    }

    /** The one-line summary for a row, with a hint of what was not shown. */
    function rowText(row) {
      const preview = row.preview
      if (!preview) return row.type ? '(无正文)' : '(事件缺失)'
      if (preview.text) return preview.text
      const only = []
      if (preview.images) only.push(`${preview.images} 张图片`)
      if (preview.reasoning) only.push('仅推理内容')
      if (preview.other) only.push(`${preview.other} 个未知块`)
      if (preview.kind === 'tool/result') only.unshift('空结果')
      return only.length ? `(${only.join(' · ')})` : '(空)'
    }

    // ---- panel -----------------------------------------------------------
    function BallastSurface() {
      const rootRef = React.useRef(null)
      const open = useOpen()
      const [state, setState] = React.useState({
        loading: false,
        availability: 'unknown',
        sessions: [],
        selected: null,
        measure: null,
        error: null
      })

      const loadMeasure = React.useCallback(async (sessionId) => {
        if (!sessionId) return
        const res = await fetch(`/dsh-ballast/api?action=measure&sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: 'application/json' } })
        const body = await res.json().catch(() => ({}))
        if (!body.ok) {
          setState((s) => ({ ...s, measure: null, error: `measure ${res.status}: ${body.code || ''}` }))
          return
        }
        setState((s) => ({ ...s, measure: body.measurement, error: null }))
      }, [])

      const refresh = React.useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }))
        try {
          const res = await fetch('/dsh-ballast/api?action=sessions', { headers: { accept: 'application/json' } })
          const body = await res.json()
          if (!body.ok) throw new Error(body.code || ('HTTP ' + res.status))
          const sessions = body.sessions || []
          const keep = sessions.some((x) => x.sessionId === state.selected) ? state.selected
            : (sessions[0] || {}).sessionId || null
          setState((s) => ({
            ...s,
            loading: false,
            availability: body.availability || 'unavailable',
            sessions,
            selected: keep,
            measure: keep ? s.measure : null
          }))
          if (keep) await loadMeasure(keep)
        } catch (e) {
          setState((s) => ({ ...s, loading: false, error: String((e && e.message) || e) }))
        }
      }, [state.selected, loadMeasure])

      React.useEffect(() => {
        if (!open) return
        refresh()
        const dismiss = (event) => {
          const target = event.target
          const dockButton = target && typeof target.closest === 'function'
            ? target.closest('[data-createhelper-dock-item="ballast"]')
            : null
          if (!dockButton && rootRef.current && !rootRef.current.contains(target)) setOpen(false)
        }
        const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', dismiss)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
          document.removeEventListener('pointerdown', dismiss)
          document.removeEventListener('keydown', closeOnEscape)
        }
      }, [open])

      // Picking a session from the dropdown measures it without a full list
      // refresh — the list is already known and the panel should respond now.
      const selectSession = (sessionId) => {
        setState((s) => ({ ...s, selected: sessionId, measure: null, error: null }))
        loadMeasure(sessionId)
      }

      if (!open) return null

      const measurement = state.measure
      const rows = measurement ? measurement.rows : []
      const max = rows.length ? rows[0].tokens : 0
      const availabilityLabel = state.availability === 'available' ? '计量就绪'
        : state.availability === 'unavailable' ? 'tokenMeter 未就绪'
          : '检测中'

      return h('div', { className: 'dshbl-layer', ref: rootRef },
        h('div', { className: 'dshbl-head' },
          h('span', { className: 'dshbl-title' }, 'ballast'),
          h('span', { className: 'dshbl-sub' }, '窗口被谁占了'),
          h('span', { className: 'dshbl-spacer' }),
          h('span', { className: 'dshbl-count' }, rows.length + ' 条'),
          h('button', {
            className: 'dshbtn', key: 'refresh', title: '重新计量', disabled: state.loading,
            onClick: refresh
          }, state.loading ? '刷新中' : '刷新'),
          h('button', { className: 'dshbtn', key: 'close', title: '关闭', onClick: () => setOpen(false) }, '×')
        ),
        h('div', { className: 'dshbl-body' },
          h('div', { className: 'dshbl-controls' },
            h('select', {
              className: 'dshbl-select',
              value: state.selected || '',
              onChange: (e) => selectSession(e.target.value)
            },
              state.sessions.length === 0
                ? h('option', { value: '' }, state.loading ? '加载中…' : '无活跃会话')
                : state.sessions.map((s) => h('option', { key: s.sessionId, value: s.sessionId },
                    `${s.title || s.sessionId} · ${s.eventCount} events`))
            )
          ),
          state.error && h('div', { className: 'dshbl-error' }, state.error),
          measurement && h('div', { className: 'dshbl-totals' },
            h('span', { className: 'dshbl-total-strong' }, `total ${fmt(measurement.totalTokens)}`),
            h('span', null, `surface ${fmt(measurement.surfaceTokens)}`),
            h('span', null, `delta ${fmt(measurement.surfaceDeltaTokens)}`),
            h('span', null, `baseline ${measurement.baseline.kind} ${fmt(measurement.baseline.tokens)}`),
            measurement.routePricedCount > 0 && h('span', { className: 'dshbl-spread' },
              `${measurement.routePricedCount} 条路由价差`),
            measurement.nodeCount > 0 && measurement.shadowPricing !== 'available' && h('span', {
              className: 'dshbl-meta',
              title: '此 DSH 宿主不提供 heuristic 影子价（需 >=0.1.2-alpha.2），无价差可比'
            }, '无影子价')
          ),
          rows.length === 0 && !state.error
            ? h('div', { className: 'dshbl-empty' }, measurement ? 'surface 为空' : '选择会话以计量')
            : rows.map((row) => h('div', { className: 'dshbl-row', key: row.seq },
              h('div', {
                className: 'dshbl-bar',
                style: { width: max > 0 ? `${Math.max(2, (row.tokens / max) * 100)}%` : '0%' }
              }),
              h('span', { className: 'dshbl-seq' }, `#${row.seq}`),
              h('span', { className: 'dshbl-type' }, typeLabel(row)),
              h('span', { className: 'dshbl-text', title: rowText(row) }, rowText(row)),
              row.surfaceOp === 'replace' && h('span', { className: 'dshbl-tag dshbl-tag-warn', title: '压缩写入，替换了一段 surface' }, '压'),
              row.preview && row.preview.isError && h('span', { className: 'dshbl-tag dshbl-tag-warn' }, 'err'),
              row.preview && row.preview.injected && h('span', { className: 'dshbl-tag', title: '插件注入而非用户输入' }, '注入'),
              row.preview && row.preview.interrupted && h('span', { className: 'dshbl-tag' }, '中断'),
              row.preview && row.preview.images ? h('span', { className: 'dshbl-tag' }, `${row.preview.images}图`) : null,
              row.routePriced && h('span', {
                className: 'dshbl-meta dshbl-spread',
                title: `路由价 ${fmt(row.tokens)} − heuristic 影子价 ${fmt(row.heuristicTokens)}`
              }, (row.priceDelta > 0 ? '+' : '') + fmt(row.priceDelta)),
              h('span', { className: 'dshbl-tokens' }, fmt(row.tokens))
            ))
        ),
        h('div', { className: 'dshbl-foot' },
          h('span', null, availabilityLabel),
          h('span', { className: 'dshbl-spacer' }),
          measurement && h('span', null, `log ${fmt(measurement.logRevision)} / ${fmt(measurement.eventCount)} events`)
        )
      )
    }

    // ---- plugin ----------------------------------------------------------
    const plugin = {
      apply(ctx) {
        ensureStyles()
        ctx.on('dispose', () => {
          dockItem?.dispose()
          dockItem = null
          setOpen(false)
          const styleEl = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')
          if (styleEl) styleEl.remove()
        })
        // Wait for the slot service instead of probing it once: mount order
        // against the runtime providing `slots` is not guaranteed, and a missed
        // ctx.get('slots') leaves the entry silently absent.
        ctx.inject(['slots'], (scope) => {
          const dock = getUtilityDock()
          dockItem = dock.register({
            id: 'ballast',
            order: 30,
            label: 'ballast',
            icon: BALLAST_ICON,
            active: openStore.open,
            onDeactivate: () => setOpen(false),
            onActivate: () => setOpen(!openStore.open)
          })
          scope.slots.inject('shell.overlay', () => scope.slots.register(
            { name: 'shell.overlay', id: 'ballast-panel', order: 80, label: 'ballast' },
            () => h(BallastSurface)))
        })
      }
    }

    return plugin
  }
})
