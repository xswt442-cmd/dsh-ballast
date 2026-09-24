// The Sidebar Session-row hover seat. Unlike the panel, this component renders
// while the pointer is over a row, so its contract is not only what it shows
// but what it refuses to do: it answers from facts an earlier read already
// cached, and it never starts a host request of its own. This file boots the
// real client bundle in a vm with a hand-rolled React, renders the seat, and
// drives the panel once so the cache holds something the host really answered.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const SOURCE = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const HOVER_SLOT = 'sidebar.session.row.hover'

// --- hand-rolled React ----------------------------------------------------
// Hook slots belong to a component function, not to a global render order: the
// seat and the panel both render in these tests, so one shared hook array (the
// treekeeper-style fake) would hand one component the other's slots. Effects
// run at render time and honour their dependency list, because the focus path
// under test is an effect that must fire for a request and not for a re-render.
function makeFakeReact() {
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

function allNodes(node, predicate, out = []) {
  if (!node) return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) allNodes(child, predicate, out)
  return out
}

function textOf(node) {
  if (!node) return ''
  return (node.text || '') + (node.children || []).map(textOf).join('')
}

function byClass(className) {
  return (node) => node.props && node.props.className === className
}

// Settle the async read chain: sessions -> json -> measure -> json -> cache.
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

// --- boot -----------------------------------------------------------------

function boot(server) {
  const { react, renderNode } = makeFakeReact()
  const registered = []
  const fetched = []
  const context = {
    console: { warn() {}, error() {} },
    navigator: { language: 'en-US' },
    document: {
      head: { appendChild() {} },
      createElement() {
        return { style: {}, dataset: {}, setAttribute() {}, remove() {}, appendChild() {} }
      },
      querySelector() { return null },
      addEventListener() {},
      removeEventListener() {}
    },
    window: { addEventListener() {}, removeEventListener() {} },
    fetch: async (url) => {
      fetched.push(String(url))
      return { ok: true, status: 200, json: async () => server(String(url)) }
    }
  }
  let definition = null
  context.window.__ModuleLoader__ = { load(value) { definition = value } }
  vm.runInNewContext(SOURCE, context, { filename: 'lib/client.js' })

  const plugin = definition.factory((name) => {
    assert.equal(name, 'react')
    return react
  })
  const slots = {
    inject(name, mount) { mount() },
    register(options, render) { registered.push({ options, render }) }
  }
  plugin.apply({
    get() {},
    inject(services, mount) { mount({ slots }) },
    on() {}
  })

  const entry = (name, id) => registered.find((item) =>
    item.options.name === name && item.options.id === id)
  // The hover seat registers its component directly, so a test renders it the
  // way the framework would: as an element, never by calling it bare.
  const seat = (props) => renderNode(react.createElement(entry(HOVER_SLOT, 'ballast').render, props))
  return { plugin, registered, fetched, renderNode, seat, entry }
}

// A host that answers the plugin's two read shapes with fixed facts.
function hostServer() {
  return (url) => {
    if (url.includes('action=sessions')) {
      return {
        ok: true,
        availability: 'available',
        sessions: [
          { sessionId: 'session-a', eventCount: 12, title: 'Alpha', titleSource: 'title' },
          { sessionId: 'session-b', eventCount: 3, title: 'Beta', titleSource: 'cwd' }
        ]
      }
    }
    if (url.includes('action=measure')) {
      const sessionId = decodeURIComponent((/sessionId=([^&]*)/.exec(url) || [])[1] || '')
      return {
        ok: true,
        sessionId,
        title: sessionId === 'session-a' ? 'Alpha' : 'Beta',
        titleSource: 'title',
        measurement: {
          logRevision: 12,
          eventCount: 12,
          totalTokens: 2000,
          surfaceTokens: 1234,
          nodeCount: 3,
          rows: [
            { seq: 7, type: 'assistant/message', tokens: 900 },
            { seq: 5, type: 'user/message', tokens: 334 }
          ]
        },
        projections: null
      }
    }
    return { ok: false, code: 'bad_action' }
  }
}

// --- seat registration ----------------------------------------------------

test('the seat registers on the Sidebar Session row hover card with this plugin id', () => {
  const { registered, entry } = boot(() => ({ ok: false }))
  const hover = entry(HOVER_SLOT, 'ballast')
  assert.ok(hover, 'the hover seat is never registered')
  assert.equal(typeof hover.options.order, 'number')
  assert.ok(hover.options.order > 0 && hover.options.order < 100,
    'the seat keeps a small order so it stays inside the hover card')
  assert.notEqual(hover.options.order, 10, 'the shipped schedule section owns order 10')
  // The registrations that already existed are untouched.
  assert.ok(entry('createhelper.utility.item', 'ballast'), 'the family menu row is gone')
  assert.ok(entry('shell.overlay', 'ballast-panel'), 'the panel is gone')
  assert.ok(entry('shell.overlay', 'utility-launcher'), 'the launcher claim is gone')
  assert.ok(registered.every((item) => item.options.name !== HOVER_SLOT || item.options.id === 'ballast'),
    'this plugin contributes exactly one row to the seat')
})

// --- no cached fact: the action and no number -----------------------------

test('an uncached row offers the action and fabricates no number', () => {
  const { fetched, seat } = boot(() => ({ ok: false }))
  const rendered = seat({ sessionId: 'session-a' })

  const buttons = allNodes(rendered, (node) => node.type === 'button')
  assert.equal(buttons.length, 1, 'the row offers one action')
  assert.equal(buttons[0].props.className, 'dshbl-hover-open')
  assert.equal(buttons[0].props.title, 'Open per-entry attribution for this session')
  assert.equal(textOf(rendered), 'Show breakdown')
  assert.ok(!/\d/.test(textOf(rendered)), 'nothing cached must render no digit at all')
  assert.equal(allNodes(rendered, byClass('dshbl-hover-fact')).length, 0,
    'with nothing cached there is no summary element')
  assert.deepEqual(fetched, [], 'rendering the seat must not call the host')

  // The seat needs a Session identity; without one it renders nothing rather
  // than a row whose action could not work.
  assert.equal(seat({}), null)
})

// --- cached fact + the action focuses the panel ---------------------------

test('the row repeats a cached measurement, and its action focuses the panel on that session', async () => {
  const { fetched, renderNode, seat, entry } = boot(hostServer())

  // Open the panel the way a user does, so its own read fills the cache.
  const menuTree = renderNode(entry('createhelper.utility.item', 'ballast').render({}))
  allNodes(menuTree, (node) => node.type === 'button')[0].props.onClick()
  const panel = entry('shell.overlay', 'ballast-panel')
  renderNode(panel.render())
  await settle()
  assert.ok(fetched.includes('/dsh-ballast/api?action=measure&sessionId=session-a'),
    'the panel should have measured the session it selected')

  const readsAfterPanel = fetched.length

  // The measured session shows its numbers, read from the cache.
  const measured = seat({ sessionId: 'session-a' })
  assert.match(textOf(measured), /surface 1,234 · heaviest #7 900/)
  assert.match(textOf(measured), /Show breakdown/)

  // A listed but unmeasured session has no token figure, so it shows none —
  // only the log length the list really carried.
  const listed = seat({ sessionId: 'session-b' })
  assert.equal(textOf(listed), 'log 3 eventsShow breakdown')
  assert.doesNotMatch(textOf(listed), /surface|heaviest/, 'an unmeasured session gets no token figure')

  assert.equal(fetched.length, readsAfterPanel, 'rendering cached rows must not call the host')

  // The action targets session-b, which is not the session the open panel had
  // selected: only a real focus path can produce that measure request.
  allNodes(listed, (node) => node.type === 'button')[0].props.onClick()
  renderNode(panel.render())
  await settle()
  const measures = fetched.filter((url) => url.includes('action=measure'))
  assert.equal(measures[measures.length - 1], '/dsh-ballast/api?action=measure&sessionId=session-b',
    'the action must open the panel focused on the row sessionId')

  // The measured row's own action moves the panel back: the entry point works
  // whether or not the row has a cached fact to show beside it.
  allNodes(measured, (node) => node.type === 'button')[0].props.onClick()
  renderNode(panel.render())
  await settle()
  const after = fetched.filter((url) => url.includes('action=measure'))
  assert.equal(after[after.length - 1], '/dsh-ballast/api?action=measure&sessionId=session-a')
})
