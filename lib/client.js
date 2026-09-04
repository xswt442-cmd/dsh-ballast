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

    /**
     * A missing, blank, or non-string `label` would reach `render()` as `undefined`
     * and produce aria-label="undefined". `id` is always present (register() rejects
     * an empty one), so it is the safe, meaningful accessible name. Normalize once
     * on store — not at every render — so the stored item is always valid.
     */
    const normalizeDockLabel = (item) => {
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      return label || item.id
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
          items.set(item.id, { ...item, registration, label: normalizeDockLabel(item), order: Number(item.order) || 0, active: !!item.active })
          render()
          return {
            update(patch) {
              const current = items.get(item.id)
              if (!current || current.registration !== registration) return
              const next = { ...current, ...patch }
              // Keep the stored label valid even when `update({ label })` is passed.
              next.label = normalizeDockLabel(next)
              items.set(item.id, next)
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
        '.dshbl-projections{margin:0 10px 8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);display:grid;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-projection-line{display:flex;flex-wrap:wrap;gap:8px}' +
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
    const localeStore = { revision: 0, listeners: new Set() }
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

    const useLocaleRevision = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1)
        localeStore.listeners.add(listener)
        return () => localeStore.listeners.delete(listener)
      }, [])
    }

    // ---- view helpers ----------------------------------------------------
    const LOCALE_NS = 'dsh-ballast'
    const ZH = {
      'dock.label': '窗口压舱物',
      'subtitle': '窗口被谁占了',
      'type.user': '用户', 'type.assistant': '助手', 'type.tool': '工具',
      'row.noBody': '(无正文)', 'row.missingEvent': '(事件缺失)',
      'row.unknownBody': '(未识别正文)', 'row.images': '{count} 张图片',
      'row.reasoningOnly': '仅推理内容', 'row.unknownBlocks': '{count} 个未知块',
      'row.emptyResult': '空结果', 'row.empty': '(空)',
      'row.truncated': '{summary}（已截断，原文 {count} 字符）',
      'shadow.absent': '无影子价',
      'shadow.absentTitle': '此 DSH 宿主不提供 heuristic 影子价（需 >=0.1.2-alpha.2），无价差可比',
      'shadow.partial': '影子价不全',
      'shadow.partialTitle': '部分条目没有 heuristic 影子价，这些条目无价差可比',
      'unit.items': '{count} 条', 'unit.events': '{count} events', 'unit.logEvents': 'log {revision} / {count} events',
      'unpriced.label': '{count} 条价格不可读',
      'unpriced.title': '宿主给出的节点价格不是数字。这些行画破折号，不参与合计与占比，也不代表 0。',
      'age.seconds': '{count} 秒前', 'age.minutes': '{count} 分钟前', 'age.hours': '{count} 小时前',
      'error.measure': 'measure 请求失败：{error}', 'error.top': 'top 请求失败：{error}',
      'availability.ready': '计量就绪', 'availability.unavailable': 'tokenMeter 未就绪', 'availability.checking': '检测中',
      'sessions.count': '{count} 个会话', 'sessions.scanning': '扫描中…',
      'refresh.title': '重新计量当前视图', 'refresh.loading': '刷新中', 'refresh.action': '刷新', 'close': '关闭',
      'sessions.loading': '加载中…', 'sessions.none': '无活跃会话',
      'host.title': '跨会话看这台机器上最重的条目（会逐个 live 会话计量）',
      'host.single': '看单会话', 'host.all': '跨会话', 'host.live': '{count} 个 live 会话',
      'host.limit': '每会话最多 {count} 条', 'host.failed': '{count} 个会话计量失败',
      'host.empty': '没有可计量的 live 会话', 'host.open': '打开这个会话的逐条归因',
      'host.surface': '该会话 surface 总量', 'surface.empty': 'surface 为空',
      'host.heaviest': '最重 {seq}', 'host.measuring': '正在计量这台机器上的每个会话…',
      'baseline.title': 'provider usage 锚点；estimated 为估算，none 表示无锚点',
      'route.count': '{count} 条路由价差', 'session.select': '选择会话以计量',
      'tag.compaction': '压缩写入，替换了一段 surface', 'tag.compactionShort': '压',
      'tag.injected': '插件注入而非用户输入', 'tag.injectedShort': '注入', 'tag.interrupted': '中断',
      'tag.images': '{count}图', 'route.title': '路由价 {route} − heuristic 影子价 {shadow}',
      'snapshot.title': '面板取到这份快照的时间；不自动刷新，快照不会自己变新',
      'projection.pressure': '下次请求 {value} / {capacity}（{percent}%）',
      'projection.pressureOnly': '最近请求 {value}',
      'projection.usage': '累计 provider usage {total}',
      'projection.cache': 'cache read {read} / write {write}',
      'projection.breakdown': '估算构成：system {system} · tools {tools} · messages {messages}'
    }
    const EN = {
      'dock.label': 'Context ballast',
      'subtitle': 'What fills the window',
      'type.user': 'User', 'type.assistant': 'Assistant', 'type.tool': 'Tool',
      'row.noBody': '(no body)', 'row.missingEvent': '(event missing)',
      'row.unknownBody': '(unrecognized body)', 'row.images': '{count} images',
      'row.reasoningOnly': 'reasoning only', 'row.unknownBlocks': '{count} unknown blocks',
      'row.emptyResult': 'empty result', 'row.empty': '(empty)',
      'row.truncated': '{summary} (truncated from {count} characters)',
      'shadow.absent': 'No shadow price',
      'shadow.absentTitle': 'This DSH host does not provide heuristic shadow prices (requires >=0.1.2-alpha.2).',
      'shadow.partial': 'Partial shadow prices',
      'shadow.partialTitle': 'Some entries have no heuristic shadow price and cannot show a spread.',
      'unit.items': '{count} items', 'unit.events': '{count} events', 'unit.logEvents': 'log {revision} / {count} events',
      'unpriced.label': '{count} unreadable prices',
      'unpriced.title': 'The host did not provide numeric prices. These rows are excluded from totals and shares; they are not zero.',
      'age.seconds': '{count}s ago', 'age.minutes': '{count}m ago', 'age.hours': '{count}h ago',
      'error.measure': 'measure request failed: {error}', 'error.top': 'top request failed: {error}',
      'availability.ready': 'Meter ready', 'availability.unavailable': 'tokenMeter unavailable', 'availability.checking': 'Checking',
      'sessions.count': '{count} sessions', 'sessions.scanning': 'Scanning…',
      'refresh.title': 'Measure the current view again', 'refresh.loading': 'Refreshing', 'refresh.action': 'Refresh', 'close': 'Close',
      'sessions.loading': 'Loading…', 'sessions.none': 'No live sessions',
      'host.title': 'Find the heaviest entries across live sessions on this host',
      'host.single': 'One session', 'host.all': 'Across sessions', 'host.live': '{count} live sessions',
      'host.limit': 'Up to {count} entries per session', 'host.failed': '{count} sessions failed',
      'host.empty': 'No measurable live sessions', 'host.open': 'Open per-entry attribution for this session',
      'host.surface': 'Session surface total', 'surface.empty': 'Surface is empty',
      'host.heaviest': 'Heaviest {seq}', 'host.measuring': 'Measuring every live session on this host…',
      'baseline.title': 'Provider usage anchor; estimated is an estimate and none means no anchor.',
      'route.count': '{count} routed-price spreads', 'session.select': 'Select a session to measure',
      'tag.compaction': 'Compaction write replacing a surface span', 'tag.compactionShort': 'cmp',
      'tag.injected': 'Injected by a plugin rather than the user', 'tag.injectedShort': 'injected', 'tag.interrupted': 'interrupted',
      'tag.images': '{count} img', 'route.title': 'Route price {route} − heuristic shadow price {shadow}',
      'snapshot.title': 'When this snapshot reached the panel; it does not refresh automatically.',
      'projection.pressure': 'Next request {value} / {capacity} ({percent}%)',
      'projection.pressureOnly': 'Latest request {value}',
      'projection.usage': 'Cumulative provider usage {total}',
      'projection.cache': 'cache read {read} / write {write}',
      'projection.breakdown': 'Estimated mix: system {system} · tools {tools} · messages {messages}'
    }
    const browserFallback = (typeof navigator !== 'undefined' &&
      String(navigator.language || '').toLowerCase().startsWith('zh')) ? ZH : EN
    let translate = fallbackTranslator(browserFallback)

    function fallbackTranslator(dict) {
      return (key, params = {}) => {
        const template = dict[key] || EN[key] || key
        return template.replace(/\{([^}]+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
      }
    }

    function setTranslator(next) {
      translate = typeof next === 'function' ? next : fallbackTranslator(ZH)
      localeStore.revision += 1
      localeStore.listeners.forEach((listener) => listener())
      dockItem?.update({ label: translate('dock.label') })
    }

    const tr = (key, params) => translate(key, params)
    // React-free, DOM-free, I/O-free: test/view.test.js evaluates this region
    // as-is instead of grepping the bundle.
    // A field the host never sent is not a measured 0: absent numbers show as
    // an em dash so the panel cannot imply a measurement it does not have.
    const fmt = (n) => (typeof n === 'number' && Number.isFinite(n)
      ? n.toLocaleString('en-US') : '—')

    /** Signed quantities always carry their sign, including the totals `delta`. */
    const fmtSigned = (n) => (typeof n === 'number' && n > 0 ? '+' : '') + fmt(n)

    function typeLabel(row) {
      const key = row.type === 'user/message' ? 'type.user'
        : row.type === 'assistant/message' ? 'type.assistant'
          : row.type === 'tool/result' ? 'type.tool' : null
      if (key) return tr(key)
      return row.type || '?'
    }

    /** The one-line summary for a row, with a hint of what was not shown. */
    function rowText(row) {
      const preview = row.preview
      if (!preview) return row.type ? tr('row.noBody') : tr('row.missingEvent')
      if (preview.text) return preview.text
      // shape === 'unknown' means the payload matched no known surface message
      // shape: there is content the plugin could not read, which is a different
      // statement from "this row is empty".
      if (preview.shape === 'unknown') return tr('row.unknownBody')
      const only = []
      if (preview.images) only.push(tr('row.images', { count: preview.images }))
      if (preview.reasoning) only.push(tr('row.reasoningOnly'))
      if (preview.other) only.push(tr('row.unknownBlocks', { count: preview.other }))
      if (preview.kind === 'tool/result') only.unshift(tr('row.emptyResult'))
      return only.length ? `(${only.join(' · ')})` : tr('row.empty')
    }

    /** The text tooltip: the summary plus what the clip removed. */
    function textHint(row) {
      const summary = rowText(row)
      const preview = row.preview
      if (preview && preview.truncated) {
        return tr('row.truncated', { summary, count: fmt(preview.chars) })
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
          label: tr('shadow.absent'),
          title: tr('shadow.absentTitle')
        }
      }
      if (measurement.shadowPricing === 'partial') {
        return { label: tr('shadow.partial'), title: tr('shadow.partialTitle') }
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
        `${fmt(group.tokens)} tokens / ${tr('unit.items', { count: group.count })}`
    }

    /** Rows whose price the host did not send as a number, if any. */
    function unpricedNote(measurement) {
      const count = measurement ? measurement.unpricedCount : 0
      if (!count) return null
      return {
        label: tr('unpriced.label', { count }),
        title: tr('unpriced.title')
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
      if (seconds < 60) return tr('age.seconds', { count: seconds })
      if (seconds < 3600) return tr('age.minutes', { count: Math.floor(seconds / 60) })
      return tr('age.hours', { count: Math.floor(seconds / 3600) })
    }

    function pressureSummary(pressure) {
      if (!pressure) return null
      const value = typeof pressure.projectedTokens === 'number' ? pressure.projectedTokens : pressure.pressureTokens
      if (typeof value !== 'number') return null
      if (typeof pressure.contextWindow !== 'number' || pressure.contextWindow <= 0) {
        return tr('projection.pressureOnly', { value: fmt(value) })
      }
      return tr('projection.pressure', {
        value: fmt(value), capacity: fmt(pressure.contextWindow),
        percent: Math.min(999, (value / pressure.contextWindow) * 100).toFixed(1)
      })
    }

    function usageSummary(usage) {
      if (!usage) return null
      const total = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
        .reduce((sum, key) => sum + (typeof usage[key] === 'number' ? usage[key] : 0), 0)
      return tr('projection.usage', { total: fmt(total) })
    }

    /**
     * Hand the spinner back — but only to the refresh that owns it.
     * `loading` disables the refresh button, so an older refresh that returns
     * late must not re-enable the button while a newer one is still in flight:
     * close and reopen the panel, and the stale read from the first pass would
     * otherwise report "not loading" during the read the user is waiting on and
     * invite a duplicate click. Pure so the ownership rule can be tested
     * without a component runtime.
     */
    function releaseLoading(ownerRef, gen) {
      if (!ownerRef || ownerRef.current !== gen) return null
      ownerRef.current = 0
      return { loading: false }
    }

    // ---- panel -----------------------------------------------------------
    function BallastSurface() {
      const rootRef = React.useRef(null)
      const open = useOpen()
      useLocaleRevision()
      const [state, setState] = React.useState({
        loading: false,
        availability: 'unknown',
        sessions: [],
        selected: null,
        measure: null,
        projections: null,
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
      // A read that resumes after its await must decide against the panel's
      // newest target, not the one its closure captured when it was queued.
      // Every user intent bumps the generation above, so a read that is still
      // current has seen no state change other than its own.
      const stateRef = React.useRef(state)
      stateRef.current = state
      // Who currently owns the spinner. Set when a refresh starts, released
      // only by that refresh (see `releaseLoading` above).
      const loadingOwner = React.useRef(0)

      const loadMeasure = React.useCallback(async (sessionId) => {
        if (!sessionId) return
        const gen = ++generation.current
        let res
        let body
        try {
          res = await fetch(`/dsh-ballast/api?action=measure&sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: 'application/json' } })
          body = await res.json().catch(() => ({}))
        } catch (e) {
          // fetch() rejects when DSH restarts, HMR drops the socket or the
          // network fails. Uncaught that is a browser unhandled rejection and
          // the panel keeps showing a snapshot as if the read had worked.
          if (gen !== generation.current) return
          setState((s) => ({ ...s, measure: null, projections: null, receivedAt: null,
            error: tr('error.measure', { error: String((e && e.message) || e) }) }))
          return
        }
        if (gen !== generation.current) return
        if (!body.ok) {
          setState((s) => ({ ...s, measure: null, projections: null, receivedAt: null,
            error: tr('error.measure', { error: `${res.status}: ${body.error || body.code || ''}` }) }))
          return
        }
        setState((s) => ({ ...s, measure: body.measurement, projections: body.projections || null,
          receivedAt: Date.now(), error: null }))
      }, [])

      const loadTop = React.useCallback(async () => {
        const gen = ++generation.current
        let res
        let body
        try {
          res = await fetch('/dsh-ballast/api?action=top&limit=5', { headers: { accept: 'application/json' } })
          body = await res.json().catch(() => ({}))
        } catch (e) {
          if (gen !== generation.current) return
          setState((s) => ({ ...s, top: null,
            error: tr('error.top', { error: String((e && e.message) || e) }) }))
          return
        }
        if (gen !== generation.current) return
        if (!body.ok) {
          setState((s) => ({ ...s, top: null,
            error: tr('error.top', { error: `${res.status}: ${body.error || body.code || ''}` }) }))
          return
        }
        setState((s) => ({ ...s, top: body, receivedAt: Date.now(), error: null }))
      }, [])

      const refresh = React.useCallback(async () => {
        // The session list is only the first half of a refresh, so the whole
        // flow runs under one stamp: a selection or view change made while it is
        // in flight must discard it, not be overwritten by it.
        const gen = ++generation.current
        // This refresh owns the spinner from here on: a later refresh takes it
        // over, an earlier one can no longer release it.
        loadingOwner.current = gen
        setState((s) => ({ ...s, loading: true, error: null }))
        let body
        try {
          const res = await fetch('/dsh-ballast/api?action=sessions', { headers: { accept: 'application/json' } })
          body = await res.json()
          if (!body.ok) throw new Error(body.error || body.code || ('HTTP ' + res.status))
        } catch (e) {
          const message = String((e && e.message) || e)
          // The message belongs to the newest intent only: reporting a failure
          // the user has already moved past is noise. The spinner belongs to
          // whoever owns it, which is not necessarily this read.
          const released = releaseLoading(loadingOwner, gen)
          // After unmount the generation is dead and the spinner owner was
          // reset, so there is nothing left to write: return before scheduling
          // a state update against a panel that no longer exists.
          if (!released && gen !== generation.current) return
          setState((s) => ({ ...s, ...released, ...(gen === generation.current ? { error: message } : {}) }))
          return
        }
        if (gen !== generation.current) {
          const released = releaseLoading(loadingOwner, gen)
          // Same rule as the catch branch: a superseded read that no longer
          // owns anything (e.g. after unmount) must not touch state at all.
          if (released) setState((s) => ({ ...s, ...released }))
          return
        }
        const sessions = body.sessions || []
        // Read the selection and the view from the newest state rather than the
        // closure: the user may have re-picked while this read was in flight.
        const current = stateRef.current
        const keep = sessions.some((x) => x.sessionId === current.selected) ? current.selected
          : (sessions[0] || {}).sessionId || null
        const wantTop = current.view === 'host'
        setState((s) => ({
          ...s,
          // Reachable only while this refresh is current, so it is the owner.
          ...releaseLoading(loadingOwner, gen),
          availability: body.availability || 'unavailable',
          sessions,
          selected: keep,
          // A measurement belongs to the session it was taken for; keeping it
          // across a changed selection would put one session's rows under
          // another session's name.
          measure: keep === s.selected ? s.measure : null,
          projections: keep === s.selected ? s.projections : null,
          top: wantTop ? null : s.top
        }))
        // Refresh keeps the view that is on screen. It must not drag the user
        // back to one session, nor fire a host-wide scan they did not ask for.
        if (wantTop) await loadTop()
        else if (keep) await loadMeasure(keep)
      }, [loadMeasure, loadTop])

      React.useEffect(() => {
        if (!open) return
        void refresh()
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
          // Unmount (HMR, plugin dispose, panel close) must invalidate reads
          // that are still in flight: they hold this component's setState and
          // would otherwise keep running against a panel that is gone. Bumping
          // the generation makes every pending read stale, so it returns at its
          // own guard without touching state; dropping the spinner owner lets a
          // later panel start clean.
          generation.current += 1
          loadingOwner.current = 0
        }
      }, [open])

      // Picking a session from the dropdown measures it without a full list
      // refresh — the list is already known and the panel should respond now.
      // `void`: the click is done once the read is queued, and the loader owns
      // reporting its own failure. Awaiting here would only make the handler
      // return a promise nothing is watching.
      const selectSession = (sessionId) => {
        setState((s) => ({ ...s, selected: sessionId, measure: null, projections: null, error: null }))
        void loadMeasure(sessionId)
      }

      const toggleHostView = () => {
        if (state.view === 'host') {
          generation.current += 1
          setState((s) => ({ ...s, view: 'session', top: null, error: null }))
          return
        }
        setState((s) => ({ ...s, view: 'host', top: null, error: null }))
        void loadTop()
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
      const availabilityLabel = state.availability === 'available' ? tr('availability.ready')
        : state.availability === 'unavailable' ? tr('availability.unavailable')
          : tr('availability.checking')
      const badge = measurement ? shadowBadge(measurement) : null
      const unpriced = measurement ? unpricedNote(measurement) : null
      const share = measurement && measurement.byType ? measurement.byType.types : []
      const age = snapshotAge(state.receivedAt, Date.now())
      const host = state.top
      const isHostView = state.view === 'host'
      const projection = state.projections
      const pressure = projection && pressureSummary(projection.contextPressure)
      const usage = projection && usageSummary(projection.tokenUsage)
      const breakdown = projection && projection.contextBreakdown

      return h('div', { className: 'dshbl-layer', ref: rootRef },
        h('div', { className: 'dshbl-head' },
          h('span', { className: 'dshbl-title' }, 'ballast'),
          h('span', { className: 'dshbl-sub' }, tr('subtitle')),
          h('span', { className: 'dshbl-spacer' }),
          h('span', { className: 'dshbl-count' },
            isHostView
              ? (host ? tr('sessions.count', { count: host.sessions.length }) : tr('sessions.scanning'))
              : tr('unit.items', { count: rows.length })),
          h('button', {
            className: 'dshbtn', key: 'refresh', title: tr('refresh.title'), disabled: state.loading,
            onClick: () => void refresh()
          }, state.loading ? tr('refresh.loading') : tr('refresh.action')),
          h('button', { className: 'dshbtn', key: 'close', title: tr('close'), onClick: () => setOpen(false) }, '×')
        ),
        h('div', { className: 'dshbl-body' },
          h('div', { className: 'dshbl-controls' },
            h('select', {
              className: 'dshbl-select',
              value: state.selected || '',
              onChange: (e) => selectSession(e.target.value)
            },
              state.sessions.length === 0
                ? h('option', { value: '' }, state.loading ? tr('sessions.loading') : tr('sessions.none'))
                : state.sessions.map((s) => h('option', { key: s.sessionId, value: s.sessionId },
                    `${s.title || s.sessionId} · ${tr('unit.events', { count: s.eventCount })}`))
            ),
            h('button', {
              className: 'dshbtn', key: 'hostview',
              title: tr('host.title'),
              'aria-pressed': isHostView ? 'true' : 'false',
              onClick: toggleHostView
            }, isHostView ? tr('host.single') : tr('host.all'))
          ),
          state.error && h('div', { className: 'dshbl-error' }, state.error),
          isHostView
            ? (host
              ? h(React.Fragment, null,
                h('div', { className: 'dshbl-totals' },
                  h('span', { className: 'dshbl-total-strong' }, tr('host.live', { count: host.sessions.length })),
                  h('span', null, tr('host.limit', { count: host.limit })),
                  host.failedCount > 0 && h('span', {
                    className: 'dshbl-spread',
                    title: host.failures.map((f) => `${f.sessionId}: ${f.error}`).join('\n')
                  }, tr('host.failed', { count: host.failedCount }))
                ),
                host.sessions.length === 0 && h('div', { className: 'dshbl-empty' }, tr('host.empty')),
                host.sessions.map((entry) => h('div', {
                  className: 'dshbl-hostrow', key: entry.sessionId,
                  title: tr('host.open'), onClick: () => openSession(entry.sessionId)
                },
                  h('span', { className: 'dshbl-seq', title: tr('host.surface') }, fmt(entry.surfaceTokens)),
                  h('span', { className: 'dshbl-text' }, entry.title || entry.sessionId),
                  entry.rows.length === 0
                    ? h('span', { className: 'dshbl-meta' }, tr('surface.empty'))
                    : h(React.Fragment, null,
                      h('span', { className: 'dshbl-type' }, typeLabel({ type: entry.rows[0].type })),
                      h('span', { className: 'dshbl-meta' }, tr('host.heaviest', { seq: entry.rows.length ? `#${entry.rows[0].seq}` : '' })),
                      h('span', { className: 'dshbl-tokens' }, fmt(entry.rows[0].tokens)))
                ))
              )
              : h('div', { className: 'dshbl-empty' }, tr('host.measuring')))
            : h(React.Fragment, null,
              measurement && h('div', { className: 'dshbl-totals' },
                h('span', { className: 'dshbl-total-strong' }, `total ${fmt(measurement.totalTokens)}`),
                h('span', null, `surface ${fmt(measurement.surfaceTokens)}`),
                h('span', null, `delta ${fmtSigned(measurement.surfaceDeltaTokens)}`),
                h('span', { title: tr('baseline.title') },
                  baselineLabel(measurement.baseline)),
                measurement.routePricedCount > 0 && h('span', { className: 'dshbl-spread' },
                  tr('route.count', { count: measurement.routePricedCount })),
                badge && h('span', { className: 'dshbl-meta', title: badge.title }, badge.label)
              ),
              projection && (pressure || usage || breakdown) && h('div', { className: 'dshbl-projections' },
                pressure && h('div', { className: 'dshbl-projection-line' }, pressure),
                usage && h('div', { className: 'dshbl-projection-line' },
                  h('span', null, usage),
                  projection.tokenUsage && h('span', null, tr('projection.cache', {
                    read: fmt(projection.tokenUsage.cacheReadTokens),
                    write: fmt(projection.tokenUsage.cacheWriteTokens)
                  }))),
                breakdown && h('div', { className: 'dshbl-projection-line' }, tr('projection.breakdown', {
                  system: fmt(breakdown.systemTokens), tools: fmt(breakdown.toolsTokens),
                  messages: fmt(breakdown.messageTokens)
                }))
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
                ? h('div', { className: 'dshbl-empty' }, measurement ? tr('surface.empty') : tr('session.select'))
                : rows.map((row) => h('div', { className: 'dshbl-row', key: row.seq },
                  h('div', { className: 'dshbl-bar', style: { width: barWidth(row, max) } }),
                  h('span', { className: 'dshbl-seq', title: timeLabel(row.time) || undefined }, `#${row.seq}`),
                  h('span', { className: 'dshbl-type' }, typeLabel(row)),
                  h('span', { className: 'dshbl-text', title: textHint(row) }, rowText(row)),
                  row.surfaceOp === 'replace' && h('span', { className: 'dshbl-tag dshbl-tag-warn', title: tr('tag.compaction') }, tr('tag.compactionShort')),
                  row.preview && row.preview.isError && h('span', { className: 'dshbl-tag dshbl-tag-warn' }, 'err'),
                  row.preview && row.preview.injected && h('span', { className: 'dshbl-tag', title: tr('tag.injected') }, tr('tag.injectedShort')),
                  row.preview && row.preview.interrupted && h('span', { className: 'dshbl-tag' }, tr('tag.interrupted')),
                  row.preview && row.preview.images ? h('span', { className: 'dshbl-tag' }, tr('tag.images', { count: row.preview.images })) : null,
                  row.routePriced && h('span', {
                    className: 'dshbl-meta dshbl-spread',
                    title: tr('route.title', { route: fmt(row.tokens), shadow: fmt(row.heuristicTokens) })
                  }, fmtSigned(row.priceDelta)),
                  h('span', { className: 'dshbl-tokens' }, fmt(row.tokens))
                ))
            )
        ),
        h('div', { className: 'dshbl-foot' },
          h('span', null, availabilityLabel),
          !isHostView && unpriced && h('span', { className: 'dshbl-meta dshbl-spread', title: unpriced.title }, unpriced.label),
          h('span', { className: 'dshbl-spacer' }),
          age && h('span', { title: tr('snapshot.title') }, age),
          !isHostView && measurement && h('span', null,
            tr('unit.logEvents', { revision: fmt(measurement.logRevision), count: fmt(measurement.eventCount) }))
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
        // RC1 owns the language preference. Older hosts simply never satisfy
        // this optional injection and keep the browser-language fallback.
        ctx.inject(['locale'], (scope) => {
          const locale = scope.locale
          if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return
          let releaseDictionary = null
          try { releaseDictionary = locale.register(LOCALE_NS, { zh: ZH, en: EN }) } catch (e) { return }
          const bound = locale.bind(LOCALE_NS)
          const sync = () => setTranslator(bound)
          const unsubscribe = typeof locale.subscribe === 'function' ? locale.subscribe(sync) : null
          sync()
          if (typeof scope.on === 'function') {
            scope.on('dispose', () => {
              if (typeof unsubscribe === 'function') unsubscribe()
              if (typeof releaseDictionary === 'function') releaseDictionary()
              setTranslator(fallbackTranslator(browserFallback))
            })
          }
        })
        // Wait for the slot service instead of probing it once: mount order
        // against the runtime providing `slots` is not guaranteed, and a missed
        // ctx.get('slots') leaves the entry silently absent.
        ctx.inject(['slots'], (scope) => {
          const dock = getUtilityDock()
          dockItem = dock.register({
            id: 'ballast',
            order: 30,
            label: tr('dock.label'),
            icon: BALLAST_ICON,
            active: openStore.open,
            onDeactivate: () => setOpen(false),
            onActivate: () => setOpen(!openStore.open)
          })
          scope.slots.inject('shell.overlay', () => scope.slots.register(
            { name: 'shell.overlay', id: 'ballast-panel', order: 80,
              label: () => tr('dock.label'), locale: LOCALE_NS },
            () => h(BallastSurface)))
        })
      }
    }

    return plugin
  }
})
