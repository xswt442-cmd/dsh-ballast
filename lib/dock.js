// Shared createhelper utility dock bootstrap — CANONICAL COPY.
//
// One source, three plugins (dsh-ballast, dsh-instance-manager,
// dsh-treekeeper). DSH serves a plugin's client artifact as a single
// self-contained classic script (packages/client/modules readFileSync's
// exports["./client"] and only strips source-map comments — there is no
// bundler at serve time), so this module is embedded verbatim into each
// client.js rather than imported at runtime. That keeps the handoff rule
// intact: the dock stays a page-local convention with no npm package and no
// front-dependency any plugin must install.
//
// test/dock.test.js runs these bytes against a fake DOM, and
// test/dock-parity.test.js asserts client.js embeds them unchanged — editing
// one side without the other fails the suite.
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
