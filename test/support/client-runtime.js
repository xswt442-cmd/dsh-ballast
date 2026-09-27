// A real runtime for the browser half, shared by the client test files.
//
// `lib/client.js` is a classic script that hands its definition to
// `window.__ModuleLoader__`, so the honest way to test it is to evaluate it and
// render what it registers: a text assertion over the source passes when the
// identifier only appears in a comment, while a rendered tree passes only when the
// component behaves. This module boots the bundle in a vm over a hand-rolled
// React, and exposes the seats the way the shell would mount them.
//
// The sandbox carries no `require`, `module`, `exports`, `process` or ESM loader,
// so a client half that reached for a Node builtin or an `import` fails at boot
// here instead of passing a grep for it.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const CLIENT_SOURCE = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

/** The launcher menu seat this plugin contributes one row to (dock fragment). */
export const UTILITY_ITEM_SLOT = 'createhelper.utility.item'
/** The shell layer seat: the launcher itself and this plugin's panel. */
export const OVERLAY_SLOT = 'shell.overlay'
/** The Sidebar Session row hover card seat. */
export const HOVER_SLOT = 'sidebar.session.row.hover'

// --- hand-rolled React ----------------------------------------------------
// Hook slots belong to a component function, not to a global render order: the
// seat, the menu row and the panel all render in these tests, so one shared hook
// array would hand one component the other's slots. Effects run at render time and
// honour their dependency list, because the paths under test are effects that must
// fire for an open and not for a re-render.
export function makeFakeReact() {
  const stores = new Map()
  let current = null

  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity)
        .filter((child) => child !== null && child !== undefined && child !== false && child !== true)
      return { type, props: props || {}, children: flat }
    },
    useState(initial) {
      const store = current
      const index = store.index++
      if (!(index in store.hooks)) store.hooks[index] = typeof initial === 'function' ? initial() : initial
      return [store.hooks[index], (value) => {
        store.hooks[index] = typeof value === 'function' ? value(store.hooks[index]) : value
      }]
    },
    useRef(initial) {
      const store = current
      const index = store.index++
      if (!(index in store.hooks)) store.hooks[index] = { current: initial }
      return store.hooks[index]
    },
    useCallback(callback) { return callback },
    useEffect(callback, deps) {
      const store = current
      const index = store.index++
      const previous = store.hooks[index]
      const changed = previous === undefined || deps === undefined || previous.deps === undefined ||
        deps.some((value, at) => !Object.is(value, previous.deps[at]))
      if (!changed) return
      if (previous && typeof previous.cleanup === 'function') previous.cleanup()
      store.hooks[index] = { deps, cleanup: undefined }
      const cleanup = callback()
      if (typeof cleanup === 'function') store.hooks[index].cleanup = cleanup
    }
  }

  const storeFor = (type) => {
    let store = stores.get(type)
    if (!store) {
      store = { hooks: [], index: 0 }
      stores.set(type, store)
    }
    return store
  }

  function renderNode(element) {
    if (element === null || element === undefined || element === false || element === true) return null
    if (typeof element !== 'object') return { type: 'text', props: {}, text: String(element), children: [] }
    if (element.type === react.Fragment) {
      return { type: 'fragment', props: {}, children: (element.children || []).map(renderNode).filter(Boolean) }
    }
    if (typeof element.type === 'function') {
      const store = storeFor(element.type)
      store.index = 0
      const previous = current
      current = store
      let rendered
      try { rendered = element.type(element.props) } finally { current = previous }
      return renderNode(rendered)
    }
    return {
      type: element.type,
      props: element.props || {},
      children: (element.children || []).map(renderNode).filter(Boolean)
    }
  }

  return { react, renderNode }
}

// --- tree helpers ---------------------------------------------------------

export function allNodes(node, predicate, out = []) {
  if (!node) return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) allNodes(child, predicate, out)
  return out
}

export function textOf(node) {
  if (!node) return ''
  return (node.text || '') + (node.children || []).map(textOf).join('')
}

export function byClass(className) {
  return (node) => node.props && node.props.className === className
}

/** Buttons in a rendered tree, in document order. */
export const buttonsIn = (node) => allNodes(node, (item) => item.type === 'button')

/** Settle an async read chain: request -> json -> state -> follow-up request. */
export const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

// --- fake document --------------------------------------------------------

// Only the two selectors the plugin actually asks about are answered: the
// per-plugin stylesheet (which `ensureStyles` injects and the dispose path removes)
// and everything else, which is the shell's own DOM and reads as absent.
function makeDocument() {
  const liveStyles = []
  const listeners = []
  const styleFor = (id) => liveStyles.find((element) => element.attributes['data-plugin-css'] === id) || null
  return {
    listeners,
    head: {
      appendChild(element) {
        if (!liveStyles.includes(element)) liveStyles.push(element)
      }
    },
    createElement(tag) {
      const attributes = {}
      return {
        tagName: tag,
        attributes,
        style: {},
        dataset: {},
        children: [],
        textContent: '',
        setAttribute(name, value) { attributes[name] = String(value) },
        appendChild(child) { this.children.push(child) },
        remove() {
          const at = liveStyles.indexOf(this)
          if (at !== -1) liveStyles.splice(at, 1)
        }
      }
    },
    querySelector(selector) {
      const style = /^style\[data-plugin-css="(.+)"\]$/.exec(selector)
      if (style) return styleFor(style[1])
      return null
    },
    addEventListener(type, handler) { listeners.push({ type, handler }) },
    removeEventListener(type, handler) {
      const at = listeners.findIndex((item) => item.type === type && item.handler === handler)
      if (at !== -1) listeners.splice(at, 1)
    },
    hasStyle: (id) => styleFor(id) !== null
  }
}

// --- boot -----------------------------------------------------------------

/**
 * Evaluate the client bundle and apply the plugin it registers.
 * @param server - `(url) => body`, the host the panel reads from.
 */
export function bootClient({ server = () => ({ ok: false }) } = {}) {
  const { react, renderNode } = makeFakeReact()
  const registered = []
  const fetched = []
  const documentMock = makeDocument()
  const windowMock = { addEventListener() {}, removeEventListener() {} }
  const context = {
    console: { warn() {}, error() {} },
    navigator: { language: 'en-US' },
    document: documentMock,
    window: windowMock,
    fetch: async (url) => {
      fetched.push(String(url))
      return { ok: true, status: 200, json: async () => server(String(url)) }
    }
  }

  let definition = null
  windowMock.__ModuleLoader__ = { load(value) { definition = value } }
  vm.runInNewContext(CLIENT_SOURCE, context, { filename: 'lib/client.js' })
  assert.ok(definition, 'the bundle never registered itself with window.__ModuleLoader__')

  const plugin = definition.factory((name) => {
    assert.equal(name, 'react', 'the bundle must take React from the platform seed')
    return react
  })
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
    return renderNode(react.createElement(seat.render, props))
  }
  // The shell's own slot renderer, which the launcher asks for by name.
  const renderSlot = (name) => react.createElement(react.Fragment, null,
    registered.filter((item) => item.options.name === name)
      .map((item) => react.createElement(item.render, { key: item.options.id })))

  return {
    react,
    renderNode,
    definition,
    plugin,
    registered,
    fetched,
    entry,
    renderSeat,
    renderSlot,
    sandbox: context,
    window: windowMock,
    document: documentMock,
    // Everything the shell would run when this plugin is unloaded.
    dispose: async () => {
      for (const handler of disposers.splice(0)) await handler()
    }
  }
}
