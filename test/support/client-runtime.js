// A real runtime for the browser half, shared by the client test files.
//
// `lib/client.js` is a classic script that hands its definition to
// `window.__ModuleLoader__`, so the honest way to test it is to evaluate it and
// render what it registers: a text assertion over the source passes when the
// identifier only appears in a comment, while a rendered tree passes only when the
// component behaves. This module boots the bundle in a vm against a real DOM
// (happy-dom), the real `react` package the host ships, and the real
// `react-dom/client` renderer; every seat the plugin registers is mounted into
// its own React root and re-rendered through `React.act`, so hook state, effect
// ordering, and reconciliation are the framework's, not a stand-in's.
//
// The sandbox carries no `require`, `module`, `exports`, `process` or ESM loader,
// so a client half that reached for a Node builtin or an `import` fails at boot
// here instead of passing a grep for it.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

import React from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'

const act = React.act

// `react-dom` reads `window` / `document` off the global during rendering (event
// delegation targets, active-element lookups). Each `bootClient` repoints them at
// its own happy-dom `Window` before the first render, so the whole test file —
// which boots one client at a time — resolves those lookups against that client's
// DOM, while the vm keeps its own isolated reference to the same objects.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const CLIENT_SOURCE = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

/** The launcher menu seat this plugin contributes one row to (dock fragment). */
export const UTILITY_ITEM_SLOT = 'createhelper.utility.item'
/** The shell layer seat: the launcher itself and this plugin's panel. */
export const OVERLAY_SLOT = 'shell.overlay'
/** The Sidebar Session row hover card seat. */
export const HOVER_SLOT = 'sidebar.session.row.hover'

// --- tree helpers ---------------------------------------------------------

export function allNodes(node, predicate, out = []) {
  if (!node) return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) allNodes(child, predicate, out)
  return out
}

export function textOf(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  return (node.text || '') + (node.children || []).map(textOf).join('')
}

export function byClass(className) {
  return (node) => node.props && node.props.className === className
}

/** Buttons in a rendered tree, in document order. */
export const buttonsIn = (node) => allNodes(node, (item) => item.type === 'button')

/** Settle the render + fetch chain: flush React work and pump macrotasks. */
export const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

// --- snapshot from the real DOM -------------------------------------------

// React owns the DOM. The test-facing tree is a read-only snapshot of that DOM:
// every element node becomes a `{type, props, children}` record, every text node
// a `{type:'text', text}` record. `props` mirrors what React wrote: HTML attributes
// keep their original names (`aria-pressed`, `title`, `data-*`, …), the boolean
// `hidden` property surfaces as `props.hidden`, `class` surfaces as
// `props.className`, and every element exposes a `props.onClick()` that dispatches
// a real bubbling `click` event back through React's event system inside `act`.
// Assertions in the test files therefore read the same shape as before while every
// interaction goes through React's own event and scheduling path.

const ELEMENT_NODE = 1
const TEXT_NODE = 3

function snapshotElement(element, win) {
  const props = { onClick: () => clickIn(element, win) }
  for (const attribute of element.attributes) props[attribute.name] = attribute.value
  // React writes these through DOM properties, not attributes: `hidden` is a
  // boolean (the attribute alone would only ever read back as ""), and `class`
  // reaches a test as `className`. Both take precedence over the raw attribute.
  props.hidden = element.hidden === true
  if (element.className) props.className = element.className
  const children = []
  for (const child of element.childNodes) {
    const snap = snapshotNode(child, win)
    if (snap) children.push(snap)
  }
  return { type: String(element.tagName).toLowerCase(), props, children }
}

function snapshotNode(node, win) {
  if (node.nodeType === TEXT_NODE) return { type: 'text', props: {}, children: [], text: node.nodeValue }
  if (node.nodeType !== ELEMENT_NODE) return null
  return snapshotElement(node, win)
}

function clickIn(element, win) {
  act(() => { element.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) })
}

function snapshotContainer(container, win) {
  const roots = []
  for (const child of container.childNodes) {
    const snap = snapshotNode(child, win)
    if (snap) roots.push(snap)
  }
  if (roots.length === 0) return null
  if (roots.length === 1) return roots[0]
  return { type: 'fragment', props: {}, children: roots }
}

// --- per-boot document observer -------------------------------------------

// The client attaches dismiss / keydown listeners directly on the document; the
// tests need to observe that they go away on unmount. The observer wraps the real
// happy-dom document's `addEventListener` / `removeEventListener` so the recording
// is what React itself sees (the handler reference passed to add and to remove
// matches), and exposes `hasStyle(id)` for the plugin-stylesheet check.
function makeDocumentObserver(doc) {
  const listeners = []
  const realAdd = doc.addEventListener.bind(doc)
  const realRemove = doc.removeEventListener.bind(doc)
  doc.addEventListener = (type, handler, options) => {
    listeners.push({ type, handler })
    return realAdd(type, handler, options)
  }
  doc.removeEventListener = (type, handler, options) => {
    const at = listeners.findIndex((item) => item.type === type && item.handler === handler)
    if (at !== -1) listeners.splice(at, 1)
    return realRemove(type, handler, options)
  }
  doc.hasStyle = (id) => doc.querySelector(`style[data-plugin-css="${id}"]`) !== null
  doc.listeners = listeners
  return doc
}

// --- root registry --------------------------------------------------------

// A seat instance is a `createRoot` mounted once per identity and re-rendered on
// every subsequent call — the way the shell keeps one mounted component per slot.
// Identity is the component reference plus a structural fingerprint of the props:
// seats that take no data (the launcher, the panel, the menu row) render with the
// same fingerprint every call and therefore reuse their root and their hook state;
// seats the shell reuses across different data contexts (the Session row hover
// card is one instance per row) key on the data and mount a fresh root per context.
// A test that renders two hover cards is therefore looking at two live components,
// and a test that clicks and re-renders a panel is still looking at one.
function makeRootRegistry(win) {
  const byKey = new Map()
  const typeIds = new Map()
  let nextTypeId = 0
  const typeIdOf = (type) => {
    if (typeIds.has(type)) return typeIds.get(type)
    const id = nextTypeId++
    typeIds.set(type, id)
    return id
  }
  // A function reference in props is what the shell's own slot render hands to a
  // launcher: the reference is stable across every render of that seat, so the
  // identity of the function (not its source) is what ties two renders together.
  let nextFnId = 0
  const fnIds = new Map()
  const fnIdOf = (fn) => {
    if (fnIds.has(fn)) return fnIds.get(fn)
    const id = nextFnId++
    fnIds.set(fn, id)
    return id
  }
  const fingerprint = (value, depth = 0) => {
    if (depth > 4) return '?'
    if (value === null || value === undefined) return String(value)
    const kind = typeof value
    if (kind === 'function') return `f${fnIdOf(value)}`
    if (kind !== 'object') return `${kind}:${String(value)}`
    if (Array.isArray(value)) return `[${value.map((item) => fingerprint(item, depth + 1)).join(',')}]`
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${k}=${fingerprint(value[k], depth + 1)}`).join(',')}}`
  }

  const keyFor = (element) => `${typeIdOf(element.type)}|${fingerprint(element.props || {})}`

  const mount = (element) => {
    const key = keyFor(element)
    let entry = byKey.get(key)
    if (!entry) {
      const container = win.document.createElement('div')
      win.document.body.appendChild(container)
      entry = { container, root: createRoot(container) }
      byKey.set(key, entry)
    }
    act(() => { entry.root.render(element) })
    return snapshotContainer(entry.container, win)
  }

  return { mount }
}

// --- boot -----------------------------------------------------------------

/**
 * Evaluate the client bundle and apply the plugin it registers.
 * @param server - `(url) => body`, the host the panel reads from.
 */
export function bootClient({ server = () => ({ ok: false }) } = {}) {
  const win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  const doc = makeDocumentObserver(win.document)
  const registered = []
  const fetched = []
  const context = {
    console: { warn() {}, error() {} },
    navigator: { language: 'en-US' },
    document: doc,
    window: win,
    fetch: async (url) => {
      fetched.push(String(url))
      return { ok: true, status: 200, json: async () => server(String(url)) }
    }
  }

  let definition = null
  win.__ModuleLoader__ = { load(value) { definition = value } }
  vm.runInNewContext(CLIENT_SOURCE, context, { filename: 'lib/client.js' })
  assert.ok(definition, 'the bundle never registered itself with window.__ModuleLoader__')

  const plugin = definition.factory((name) => {
    assert.equal(name, 'react', 'the bundle must take React from the platform seed')
    return React
  })

  const registry = makeRootRegistry(win)
  const slots = {
    // The fake shell resolves every seat immediately: what these tests are about is
    // what a seat renders, not the ordering of the runtime that provides it.
    inject(name, mount) { mount() },
    register(options, render) { registered.push({ options, render }) }
  }
  const disposers = []
  plugin.apply({
    get() {},
    inject(services, mount) {
      const scope = { slots, on(event, handler) { if (event === 'dispose') disposers.push(handler) } }
      mount(scope)
      return scope
    },
    on(event, handler) { if (event === 'dispose') disposers.push(handler) }
  })

  const entry = (name, id) => registered.find((item) => item.options.name === name && item.options.id === id)
  // A seat renders the way the framework does — as an element, never by calling the
  // component bare — so its hook slots belong to it.
  const renderSeat = (name, id, props = {}) => {
    const seat = entry(name, id)
    assert.ok(seat, `no seat registered for ${name} / ${id}`)
    return registry.mount(React.createElement(seat.render, props))
  }
  // The shell's own slot renderer, which the launcher asks for by name. Registered
  // items compose under the caller's root, keyed by their slot id — the same way a
  // shell mounting a slot tree keys its children.
  const renderSlot = (name) => React.createElement(React.Fragment, null,
    registered.filter((item) => item.options.name === name)
      .map((item) => React.createElement(item.render, { key: item.options.id })))
  // Render any React element through the framework. Test files that reach for a
  // seat's render callback directly use this.
  const renderNode = (element) => registry.mount(element)

  return {
    react: React,
    renderNode,
    definition,
    plugin,
    registered,
    fetched,
    entry,
    renderSeat,
    renderSlot,
    sandbox: context,
    window: win,
    document: doc,
    // Everything the shell would run when this plugin is unloaded. Disposal
    // releases state (the panel closes itself), so its React work is flushed
    // through `act` like every other interaction.
    dispose: async () => {
      for (const handler of disposers.splice(0)) {
        await act(async () => { await handler() })
      }
    }
  }
}
