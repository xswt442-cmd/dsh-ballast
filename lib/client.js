// dsh-ballast browser half. Classic-script client bundle, the
// dsh-instance-manager pattern: register a factory with
// window.__ModuleLoader__; React comes from the platform seed, data comes from
// the same-origin JSON endpoint /dsh-ballast/api (host half).
//
// DSH serves this file byte-for-byte (packages/client/modules readFileSync's
// exports["./client"]; no bundler runs at serve time, and the transport is a
// classic <script>, so `import` is a SyntaxError). The shared dock bootstrap is
// therefore embedded below rather than imported — it is generated at build time
// from the dsh-mini-utility-dock package by `npm run dock:sync`, so edit that
// package, never this block (`npm run dock:check` fails on drift). Since the
// fragment creates the dock when none exists, ballast works standalone: no
// DIM or DTK install is needed to get an entry point.

window.__ModuleLoader__.load({
  id: 'dsh-ballast',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    // <dsh-mini-utility-dock>
    // Mini Utility Dock bootstrap. DSH client artifacts are self-contained classic
    // scripts, so this fragment is embedded at build time. At runtime the dock is a
    // page-local protocol with no package or plugin dependency.
    //
    // Protocol invariants (createhelper.dsh.utility-dock v1), all page-local:
    //   - Exactly one dock container in the page. Whoever loads first creates it;
    //     everyone else joins. Joining never takes over an existing dock.
    //   - register() requires a non-empty `id` and an `onActivate()`; a dock item
    //     is a launcher, and each plugin owns and renders its own panel.
    //   - Activating one item deactivates the others.
    //   - An item's `icon` is untrusted markup: only a presentational inline SVG
    //     reaches the page, anything else renders the label as text.
    //   - The registration disposer carries an ownership token, so a stale HMR
    //     disposer cannot delete a newer registration for the same id.
    //   - Placement is shared and persisted; `hidden` keeps a recovery entry.

    const DOCK_KEY = '__CREATEHELPER_DSH_UTILITY_DOCK_V1__'
    const DOCK_PROTOCOL = 'createhelper.dsh.utility-dock'
    const DOCK_VERSION = 1
    const DOCK_PLACEMENT_KEY = 'createhelper.utilityDock.placement'
    const DOCK_CSS_ID = 'createhelper-utility-dock'
    const DOCK_SNAPSHOT = 'createhelper.utility-dock/1+placement'
    const DOCK_LEFT_FALLBACK_PX = 80

    const warnDockGeometry = (left) => {
      if (typeof console === 'undefined' || typeof console.warn !== 'function') return
      console.warn('[dsh-mini-utility-dock] shell geometry unavailable; falling back to left=' + left + 'px')
    }

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

    /**
     * An item's `icon` is markup another plugin hands to `innerHTML`, so the dock —
     * not each registrant — owns what reaches the page. Admit a single inline SVG
     * whose tags and attributes are presentational; `href`, `style`, `on*`,
     * `<script>` and `<foreignObject>` are exactly the shapes that turn an icon
     * into a script, and none of them draws a glyph.
     */
    const DOCK_ICON_TAGS = /^(svg|g|path|rect|circle|ellipse|line|polyline|polygon)$/i
    const DOCK_ICON_ATTRS = /^(width|height|viewBox|preserveAspectRatio|fill|fill-rule|fill-opacity|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-opacity|stroke-dasharray|stroke-dashoffset|opacity|d|x|y|x1|y1|x2|y2|rx|ry|cx|cy|r|points|transform|role|aria-hidden|focusable|class)$/i

    function safeDockIcon(icon) {
      if (typeof icon !== 'string') return false
      const markup = icon.trim()
      if (!/^<svg(?:\s|>)/i.test(markup) || !/<\/svg>$/i.test(markup)) return false
      // A comment, CDATA or processing instruction can carry markup the scans below
      // never look at.
      if (/<!--|<!\[CDATA\[|<\?|]]>/.test(markup)) return false
      // Splitting on `"` pairs the quotes up: an even segment count is an unbalanced
      // quote, and only the odd-index segments are quoted values. A value holding a
      // tag boundary would move `>` past what the scans below can see.
      const quoted = markup.split('"')
      if (quoted.length % 2 === 0) return false
      for (let i = 1; i < quoted.length; i += 2) {
        if (/[<>]/.test(quoted[i])) return false
      }
      if (/[\s"']on[a-z]+\s*=/i.test(markup)) return false
      if (/javascript\s*:/i.test(markup)) return false
      // A same-document fragment reference is how a gradient is painted; anything
      // else turns a presentational attribute into a network read.
      if (/url\(\s*(?!#)/i.test(markup)) return false
      const tags = markup.match(/<\/?[a-zA-Z][^>]*>/g)
      if (!tags) return false
      for (const tag of tags) {
        const name = /^<\/?\s*([^/>\s]+)/.exec(tag)
        if (!name || !DOCK_ICON_TAGS.test(name[1])) return false
        for (const raw of tag.match(/[^=<>\s]+\s*=/g) || []) {
          if (!DOCK_ICON_ATTRS.test(raw.replace(/\s*=$/, ''))) return false
        }
      }
      return true
    }

    /** Two characters stand in for an icon the dock could not admit. */
    function dockIconFallback(item) {
      const label = String(item.label || item.id || '')
      return label.slice(0, 2)
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
      const findShellFrame = () => {
        const overlay = document.querySelector('[data-shell-overlay]')
        return (overlay && overlay.parentElement) || null
      }
      let geometryWarned = false
      const measureDockLeft = () => {
        const frame = findShellFrame()
        const sidebar = frame && frame.firstElementChild
        const sidebarRect = sidebar && typeof sidebar.getBoundingClientRect === 'function'
          ? sidebar.getBoundingClientRect()
          : null
        if (!sidebarRect) {
          if (!geometryWarned) {
            geometryWarned = true
            warnDockGeometry(DOCK_LEFT_FALLBACK_PX)
          }
          return DOCK_LEFT_FALLBACK_PX
        }
        return Math.max(16, Math.round(sidebarRect.right + 16))
      }
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
        const left = measureDockLeft()
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
            const frame = findShellFrame()
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
          // Sanitized here, not in register(), so `update({ icon })` cannot be a
          // second way past the gate.
          if (safeDockIcon(item.icon)) button.innerHTML = item.icon
          else button.textContent = dockIconFallback(item)
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
    // </dsh-mini-utility-dock>

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
        '.dshbl-share{display:flex;height:9px;margin:0 10px 5px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}' +
        '.dshbl-share-seg{height:100%;min-width:2px;background:var(--dsw-alias-brand-primary)}' +
        '.dshbl-legend{display:flex;flex-wrap:wrap;gap:10px;padding:0 10px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-hostrow{position:relative;display:flex;align-items:baseline;gap:8px;padding:6px 10px;border-radius:9px;cursor:pointer}' +
        '.dshbl-hostrow:hover{background:var(--dsw-alias-bg-layer-2)}' +
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
    // React-free, DOM-free, I/O-free: test/view.test.js evaluates this region
    // as-is instead of grepping the bundle.
    // A field the host never sent is not a measured 0: absent numbers show as
    // an em dash so the panel cannot imply a measurement it does not have.
    const fmt = (n) => (typeof n === 'number' && Number.isFinite(n)
      ? n.toLocaleString('en-US') : '—')

    /** Signed quantities always carry their sign, including the totals `delta`. */
    const fmtSigned = (n) => (typeof n === 'number' && n > 0 ? '+' : '') + fmt(n)

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
      // shape === 'unknown' means the payload matched no known surface message
      // shape: there is content the plugin could not read, which is a different
      // statement from "this row is empty".
      if (preview.shape === 'unknown') return '(未识别正文)'
      const only = []
      if (preview.images) only.push(`${preview.images} 张图片`)
      if (preview.reasoning) only.push('仅推理内容')
      if (preview.other) only.push(`${preview.other} 个未知块`)
      if (preview.kind === 'tool/result') only.unshift('空结果')
      return only.length ? `(${only.join(' · ')})` : '(空)'
    }

    /** The text tooltip: the summary plus what the clip removed. */
    function textHint(row) {
      const summary = rowText(row)
      const preview = row.preview
      if (preview && preview.truncated) {
        return `${summary}（已截断，原文 ${fmt(preview.chars)} 字符）`
      }
      return summary
    }

    /**
     * Event time for the seq tooltip. Only an ISO-style string is rendered: a
     * bare number could be seconds or milliseconds and this plugin has not
     * verified which, so it does not get to guess.
     */
    function timeLabel(time) {
      if (typeof time !== 'string') return ''
      const ms = Date.parse(time)
      if (!Number.isFinite(ms)) return ''
      return new Date(ms).toLocaleString('zh-CN', { hour12: false })
    }

    /**
     * A `none` baseline carries no provider anchor, so its token count is an
     * absence rather than a price the host measured.
     */
    function baselineLabel(baseline) {
      const kind = (baseline && baseline.kind) || 'unknown'
      const tokens = baseline ? baseline.tokens : null
      if (kind === 'none' || typeof tokens !== 'number' || !Number.isFinite(tokens)) {
        return `baseline ${kind}`
      }
      return `baseline ${kind} ${fmt(tokens)}`
    }

    /**
     * Shadow-price availability. 'available' needs no note, and an empty
     * surface ('unknown') cannot tell the two host shapes apart, so neither
     * renders. 'partial' must not claim the host has no shadow price at all.
     */
    function shadowBadge(measurement) {
      if (measurement.shadowPricing === 'absent') {
        return {
          label: '无影子价',
          title: '此 DSH 宿主不提供 heuristic 影子价（需 >=0.1.2-alpha.2），无价差可比'
        }
      }
      if (measurement.shadowPricing === 'partial') {
        return { label: '影子价不全', title: '部分条目没有 heuristic 影子价，这些条目无价差可比' }
      }
      return null
    }

    /**
     * Bar width for a row. An unpriced row gets no bar at all: a 2% sliver
     * would read as "this one is cheap" when the truth is "this one has no
     * number".
     */
    function barWidth(row, max) {
      if (typeof row.tokens !== 'number' || !Number.isFinite(row.tokens)) return '0%'
      if (!(max > 0)) return '0%'
      return `${Math.max(2, (row.tokens / max) * 100)}%`
    }

    /** Percent digits for a host share. An absent share is 0, never "NaN". */
    const sharePct = (share, digits) => (typeof share === 'number' && Number.isFinite(share)
      ? (share * 100).toFixed(digits) : '0')

    /** Legend text for one per-type group from the host-side aggregate. */
    function shareLabel(group) {
      return `${typeLabel({ type: group.type })} ${sharePct(group.share, 1)}% · ` +
        `${fmt(group.tokens)} tokens / ${group.count} 条`
    }

    /** Rows whose price the host did not send as a number, if any. */
    function unpricedNote(measurement) {
      const count = measurement ? measurement.unpricedCount : 0
      if (!count) return null
      return {
        label: `${count} 条价格不可读`,
        title: '宿主给出的节点价格不是数字。这些行画破折号，不参与合计与占比，也不代表 0。'
      }
    }

    /**
     * How old the on-screen snapshot is. The footer already carries the log
     * revision, but a revision says nothing about staleness without a wall
     * clock — so `now` is passed in rather than read here, to keep this pure.
     */
    function snapshotAge(receivedAt, now) {
      if (typeof receivedAt !== 'number' || typeof now !== 'number') return ''
      const seconds = Math.floor((now - receivedAt) / 1000)
      if (!Number.isFinite(seconds) || seconds < 0) return ''
      if (seconds < 60) return `${seconds} 秒前`
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
      return `${Math.floor(seconds / 3600)} 小时前`
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
        receivedAt: null,
        view: 'session',
        top: null,
        error: null
      })
      // Two reads can be in flight at once — the user re-picks a session, or
      // switches view while a scan runs. Whoever answers last would win, and a
      // panel showing B's title over A's rows is not slow, it is wrong. Every
      // read stamps the generation it started at and drops its answer if that
      // stamp is no longer current.
      const generation = React.useRef(0)

      const loadMeasure = React.useCallback(async (sessionId) => {
        if (!sessionId) return
        const gen = ++generation.current
        const res = await fetch(`/dsh-ballast/api?action=measure&sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: 'application/json' } })
        const body = await res.json().catch(() => ({}))
        if (gen !== generation.current) return
        if (!body.ok) {
          setState((s) => ({ ...s, measure: null, receivedAt: null, error: `measure ${res.status}: ${body.error || body.code || ''}` }))
          return
        }
        setState((s) => ({ ...s, measure: body.measurement, receivedAt: Date.now(), error: null }))
      }, [])

      const loadTop = React.useCallback(async () => {
        const gen = ++generation.current
        const res = await fetch('/dsh-ballast/api?action=top&limit=5', { headers: { accept: 'application/json' } })
        const body = await res.json().catch(() => ({}))
        if (gen !== generation.current) return
        if (!body.ok) {
          setState((s) => ({ ...s, top: null, error: `top ${res.status}: ${body.error || body.code || ''}` }))
          return
        }
        setState((s) => ({ ...s, top: body, receivedAt: Date.now(), error: null }))
      }, [])

      const refresh = React.useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }))
        try {
          const res = await fetch('/dsh-ballast/api?action=sessions', { headers: { accept: 'application/json' } })
          const body = await res.json()
          if (!body.ok) throw new Error(body.error || body.code || ('HTTP ' + res.status))
          const sessions = body.sessions || []
          const keep = sessions.some((x) => x.sessionId === state.selected) ? state.selected
            : (sessions[0] || {}).sessionId || null
          const wantTop = state.view === 'host'
          setState((s) => ({
            ...s,
            loading: false,
            availability: body.availability || 'unavailable',
            sessions,
            selected: keep,
            measure: keep ? s.measure : null,
            top: wantTop ? null : s.top
          }))
          // Refresh keeps the view that is on screen. It must not drag the user
          // back to one session, nor fire a host-wide scan they did not ask for.
          if (wantTop) await loadTop()
          else if (keep) await loadMeasure(keep)
        } catch (e) {
          setState((s) => ({ ...s, loading: false, error: String((e && e.message) || e) }))
        }
      }, [state.selected, state.view, loadMeasure, loadTop])

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

      const toggleHostView = () => {
        if (state.view === 'host') {
          generation.current += 1
          setState((s) => ({ ...s, view: 'session', top: null, error: null }))
          return
        }
        setState((s) => ({ ...s, view: 'host', top: null, error: null }))
        loadTop()
      }

      const openSession = (sessionId) => {
        setState((s) => ({ ...s, view: 'session', top: null }))
        selectSession(sessionId)
      }

      if (!open) return null

      const measurement = state.measure
      const rows = measurement ? measurement.rows : []
      // The bar scale is the heaviest *priced* row; a leading row without a
      // number must not turn the whole panel's scale into NaN.
      const max = rows.length && typeof rows[0].tokens === 'number' ? rows[0].tokens : 0
      const availabilityLabel = state.availability === 'available' ? '计量就绪'
        : state.availability === 'unavailable' ? 'tokenMeter 未就绪'
          : '检测中'
      const badge = measurement ? shadowBadge(measurement) : null
      const unpriced = measurement ? unpricedNote(measurement) : null
      const share = measurement && measurement.byType ? measurement.byType.types : []
      const age = snapshotAge(state.receivedAt, Date.now())
      const host = state.top
      const isHostView = state.view === 'host'

      return h('div', { className: 'dshbl-layer', ref: rootRef },
        h('div', { className: 'dshbl-head' },
          h('span', { className: 'dshbl-title' }, 'ballast'),
          h('span', { className: 'dshbl-sub' }, '窗口被谁占了'),
          h('span', { className: 'dshbl-spacer' }),
          h('span', { className: 'dshbl-count' },
            isHostView ? (host ? `${host.sessions.length} 个会话` : '扫描中…') : `${rows.length} 条`),
          h('button', {
            className: 'dshbtn', key: 'refresh', title: '重新计量当前视图', disabled: state.loading,
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
            ),
            h('button', {
              className: 'dshbtn', key: 'hostview',
              title: '跨会话看这台机器上最重的条目（会逐个 live 会话计量）',
              'aria-pressed': isHostView ? 'true' : 'false',
              onClick: toggleHostView
            }, isHostView ? '看单会话' : '跨会话')
          ),
          state.error && h('div', { className: 'dshbl-error' }, state.error),
          isHostView
            ? (host
              ? h(React.Fragment, null,
                h('div', { className: 'dshbl-totals' },
                  h('span', { className: 'dshbl-total-strong' }, `${host.sessions.length} 个 live 会话`),
                  h('span', null, `每会话最多 ${host.limit} 条`),
                  host.failedCount > 0 && h('span', {
                    className: 'dshbl-spread',
                    title: host.failures.map((f) => `${f.sessionId}: ${f.error}`).join('\n')
                  }, `${host.failedCount} 个会话计量失败`)
                ),
                host.sessions.length === 0 && h('div', { className: 'dshbl-empty' }, '没有可计量的 live 会话'),
                host.sessions.map((entry) => h('div', {
                  className: 'dshbl-hostrow', key: entry.sessionId,
                  title: '打开这个会话的逐条归因', onClick: () => openSession(entry.sessionId)
                },
                  h('span', { className: 'dshbl-seq', title: '该会话 surface 总量' }, fmt(entry.surfaceTokens)),
                  h('span', { className: 'dshbl-text' }, entry.title || entry.sessionId),
                  entry.rows.length === 0
                    ? h('span', { className: 'dshbl-meta' }, 'surface 为空')
                    : h(React.Fragment, null,
                      h('span', { className: 'dshbl-type' }, typeLabel({ type: entry.rows[0].type })),
                      h('span', { className: 'dshbl-meta' }, `最重 ${entry.rows.length ? `#${entry.rows[0].seq}` : ''}`),
                      h('span', { className: 'dshbl-tokens' }, fmt(entry.rows[0].tokens)))
                ))
              )
              : h('div', { className: 'dshbl-empty' }, '正在计量这台机器上的每个会话…'))
            : h(React.Fragment, null,
              measurement && h('div', { className: 'dshbl-totals' },
                h('span', { className: 'dshbl-total-strong' }, `total ${fmt(measurement.totalTokens)}`),
                h('span', null, `surface ${fmt(measurement.surfaceTokens)}`),
                h('span', null, `delta ${fmtSigned(measurement.surfaceDeltaTokens)}`),
                h('span', { title: 'provider usage 锚点；estimated 为估算，none 表示无锚点' },
                  baselineLabel(measurement.baseline)),
                measurement.routePricedCount > 0 && h('span', { className: 'dshbl-spread' },
                  `${measurement.routePricedCount} 条路由价差`),
                badge && h('span', { className: 'dshbl-meta', title: badge.title }, badge.label)
              ),
              // The aggregate comes from the host: one defined share rule rather
              // than three views each summing the rows differently.
              share.length > 0 && h('div', { className: 'dshbl-share' },
                share.map((group) => group.share > 0 && h('span', {
                  className: 'dshbl-share-seg',
                  key: group.type || 'unknown',
                  style: { width: `${sharePct(group.share, 2)}%` },
                  title: shareLabel(group)
                }))
              ),
              share.length > 0 && h('div', { className: 'dshbl-legend' },
                share.map((group) => h('span', { key: group.type || 'unknown', title: shareLabel(group) },
                  `${typeLabel({ type: group.type })} ${sharePct(group.share, 0)}%`))
              ),
              rows.length === 0 && !state.error
                ? h('div', { className: 'dshbl-empty' }, measurement ? 'surface 为空' : '选择会话以计量')
                : rows.map((row) => h('div', { className: 'dshbl-row', key: row.seq },
                  h('div', { className: 'dshbl-bar', style: { width: barWidth(row, max) } }),
                  h('span', { className: 'dshbl-seq', title: timeLabel(row.time) || undefined }, `#${row.seq}`),
                  h('span', { className: 'dshbl-type' }, typeLabel(row)),
                  h('span', { className: 'dshbl-text', title: textHint(row) }, rowText(row)),
                  row.surfaceOp === 'replace' && h('span', { className: 'dshbl-tag dshbl-tag-warn', title: '压缩写入，替换了一段 surface' }, '压'),
                  row.preview && row.preview.isError && h('span', { className: 'dshbl-tag dshbl-tag-warn' }, 'err'),
                  row.preview && row.preview.injected && h('span', { className: 'dshbl-tag', title: '插件注入而非用户输入' }, '注入'),
                  row.preview && row.preview.interrupted && h('span', { className: 'dshbl-tag' }, '中断'),
                  row.preview && row.preview.images ? h('span', { className: 'dshbl-tag' }, `${row.preview.images}图`) : null,
                  row.routePriced && h('span', {
                    className: 'dshbl-meta dshbl-spread',
                    title: `路由价 ${fmt(row.tokens)} − heuristic 影子价 ${fmt(row.heuristicTokens)}`
                  }, fmtSigned(row.priceDelta)),
                  h('span', { className: 'dshbl-tokens' }, fmt(row.tokens))
                ))
            )
        ),
        h('div', { className: 'dshbl-foot' },
          h('span', null, availabilityLabel),
          !isHostView && unpriced && h('span', { className: 'dshbl-meta dshbl-spread', title: unpriced.title }, unpriced.label),
          h('span', { className: 'dshbl-spacer' }),
          age && h('span', { title: '面板取到这份快照的时间；不自动刷新，快照不会自己变新' }, age),
          !isHostView && measurement && h('span', null,
            `log ${fmt(measurement.logRevision)} / ${fmt(measurement.eventCount)} events`)
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
