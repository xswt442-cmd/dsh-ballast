import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The shared dock bootstrap is a classic-script fragment with no imports and
// no exports, because DSH serves it embedded in a single <script> artifact.
// These tests therefore run lib/dock.js's own bytes against a fake DOM, so the
// contract is verified on the canonical source rather than on a paraphrase.
const DOCK_SRC = readFileSync(new URL('../lib/dock.js', import.meta.url), 'utf8')

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    style: { setProperty() { } },
    attributes: {},
    listeners: {},
    hidden: false,
    parentElement: null,
    innerHTML: '',
    className: '',
    textContent: '',
    setAttribute(key, value) { this.attributes[key] = String(value) },
    getAttribute(key) { return this.attributes[key] },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child },
    removeChild(child) { this.children = this.children.filter((x) => x !== child); child.parentElement = null },
    replaceChildren() { for (const child of this.children) child.parentElement = null; this.children = [] },
    remove() { if (this.parentElement) this.parentElement.removeChild(this) },
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler) },
    removeEventListener() { },
    contains(other) {
      let node = other
      while (node) { if (node === this) return true; node = node.parentElement }
      return false
    },
    click() { for (const handler of this.listeners.click || []) handler({ target: this }) }
  }
}

function makeEnv() {
  const head = makeElement('head')
  const body = makeElement('body')
  const documentElement = makeElement('html')
  const created = []
  const store = new Map()
  const env = {
    window: { listeners: {}, addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler) }, removeEventListener() { } },
    document: {
      head,
      body,
      documentElement,
      createElement(tag) { const el = makeElement(tag); created.push(el); return el },
      // Only the dock-chrome attribute selector is ever queried here; the
      // shell-overlay probe answers "no shell yet".
      querySelector(selector) {
        const match = /^style\[data-plugin-css="(.+)"\]$/.exec(selector)
        if (match) return head.children.find((el) => el.getAttribute('data-plugin-css') === match[1]) || null
        return null
      }
    },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value))
    },
    created,
    store
  }
  return env
}

function loadDock(env) {
  const evaluate = new Function(
    'window', 'document', 'localStorage', 'ResizeObserver', 'MutationObserver',
    `${DOCK_SRC}\nreturn { getUtilityDock, isCompatibleDock, safeDockIcon, DOCK_KEY, DOCK_SNAPSHOT }`
  )
  return evaluate(env.window, env.document, env.localStorage, undefined, undefined)
}

const item = (id, extra) => ({ id, label: id, onActivate() { }, ...extra })

test('lib/dock.js is a classic-script fragment', () => {
  // It is concatenated into a <script>, so any ESM syntax is a page-wide
  // SyntaxError, not a lint nit.
  assert.ok(!/^\s*(import|export)\s/m.test(DOCK_SRC), 'dock module must not import or export')
})

test('the first plugin to load creates the dock and publishes the protocol', () => {
  const dock = loadDock(makeEnv())
  const api = dock.getUtilityDock()
  assert.equal(api.protocol, 'createhelper.dsh.utility-dock')
  assert.equal(api.version, 1)
  assert.equal(api.snapshot, dock.DOCK_SNAPSHOT)
  for (const method of ['register', 'setPlacement', 'getPlacement']) {
    assert.equal(typeof api[method], 'function', `${method} is part of the contract`)
  }
})

test('the created dock is published under the shared key', () => {
  const env = makeEnv()
  const dock = loadDock(env)
  const api = dock.getUtilityDock()
  assert.equal(env.window[dock.DOCK_KEY], api)
})

test('a later plugin joins the existing dock instead of taking it over', () => {
  const env = makeEnv()
  const dock = loadDock(env)
  const first = dock.getUtilityDock()
  first.register(item('instance-manager'))
  const second = dock.getUtilityDock()
  assert.equal(second, first, 'joining must return the incumbent api')
  assert.equal(env.document.body.children.length, 1, 'only one dock container may exist')
})

test('an incompatible dock on the key is replaced by a v1 dock', () => {
  const env = makeEnv()
  const dock = loadDock(env)
  env.window[dock.DOCK_KEY] = { register() { } }
  const api = dock.getUtilityDock()
  assert.equal(api.version, 1)
  assert.equal(env.window[dock.DOCK_KEY], api)
})

test('register requires a non-empty id and onActivate', () => {
  const api = loadDock(makeEnv()).getUtilityDock()
  assert.throws(() => api.register({ id: 'x' }), TypeError)
  assert.throws(() => api.register({ onActivate() { } }), TypeError)
  assert.throws(() => api.register({ id: '', onActivate() { } }), TypeError)
  assert.throws(() => api.register(null), TypeError)
})

test('items render as one ordered button each, labelled and pressed', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  api.register({ id: 'treekeeper', label: 'TreeKeeper', order: 20, icon: '<svg></svg>', onActivate() { } })
  api.register({ id: 'ballast', label: 'ballast', order: 30, icon: '<svg></svg>', active: true, onActivate() { } })
  api.register({ id: 'instance-manager', label: 'DSH Instance', order: 10, icon: '<svg></svg>', onActivate() { } })
  const dockEl = env.document.body.children[0]
  assert.deepEqual(dockEl.children.map((b) => b.dataset.createhelperDockItem),
    ['instance-manager', 'treekeeper', 'ballast'])
  assert.equal(dockEl.children[2].getAttribute('aria-pressed'), 'true')
  assert.equal(dockEl.children[0].getAttribute('aria-pressed'), 'false')
  assert.equal(dockEl.children[0].getAttribute('aria-label'), 'DSH Instance')
})

test('the icon gate admits presentational svg and refuses the rest', () => {
  const { safeDockIcon } = loadDock(makeEnv())
  const admitted = [
    '<svg></svg>',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 5h16M6 12h12M9 19h6"></path></svg>',
    '<svg><g transform="translate(1 1)"><circle cx="4" cy="4" r="2"></circle></g></svg>',
    '  <svg><rect x="1" y="2" width="3" height="4"></rect></svg>  ',
    '<svg fill="url(#grad)"><path d="M0 0"></path></svg>'
  ]
  for (const icon of admitted) {
    assert.equal(safeDockIcon(icon), true, `${icon} is a glyph, not a script`)
  }
  const rejected = [
    '<svg onload="alert(1)"></svg>',
    '<svg onload=alert(1)></svg>',
    '<svg/onclick=alert(1)></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>',
    '<svg><use href="#elsewhere"></use></svg>',
    '<svg><image href="https://evil/x.png"></image></svg>',
    '<svg style="background:url(https://evil)"></svg>',
    '<svg fill="url(https://evil/x.svg#p)"></svg>',
    '<svg><animate attributeName="onclick" values="alert(1)"></animate></svg>',
    '<img src="x" onerror="alert(1)">',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    // A quoted value that carries a tag boundary moves `>` past the scanner.
    '<svg viewBox="0 0 24 24" fill="none"><path d="M4 onload=alert(1)>5"></path></svg>',
    '<svg><!--<script>--></script></svg>',
    '<svg><![CDATA[</svg><script>alert(1)</script>]]></svg>',
    '<svg width="16></svg>',
    undefined,
    null,
    42,
    { toString() { return '<svg></svg>' } }
  ]
  for (const icon of rejected) {
    assert.equal(safeDockIcon(icon), false, `${String(icon)} must not reach innerHTML`)
  }
})

test('an admitted icon reaches the button; a rejected one renders a fallback', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  api.register(item('treekeeper', { label: 'TreeKeeper', order: 10, icon: '<svg></svg>' }))
  api.register(item('ballast', { label: 'ballast', order: 20, icon: '<svg onload="alert(1)"></svg>' }))
  api.register(item('dim', { label: 'DSH Instance', order: 30 }))
  const buttons = env.document.body.children[0].children
  assert.equal(buttons[0].innerHTML, '<svg></svg>')
  assert.equal(buttons[1].innerHTML, '', 'the rejected markup must never be assigned')
  assert.equal(buttons[1].textContent, 'ba')
  assert.equal(buttons[2].textContent, 'DS')
  // The label still identifies the item whatever the icon turned into.
  assert.equal(buttons[1].getAttribute('aria-label'), 'ballast')
  assert.equal(buttons[1].title, 'ballast')
})

test('update() cannot walk a poisoned icon past the gate', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  const handle = api.register(item('ballast', { label: 'ballast', icon: '<svg></svg>' }))
  const live = () => env.document.body.children[0].children[0]
  assert.equal(live().innerHTML, '<svg></svg>')
  handle.update({ icon: '<svg><script>alert(1)</script></svg>' })
  assert.equal(live().innerHTML, '', 'a re-render must not assign the new markup')
  assert.equal(live().textContent, 'ba')
})

test('activating one item deactivates the others', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  const events = []
  api.register({ id: 'a', label: 'a', order: 1, active: true, onActivate: () => events.push('a:activate'), onDeactivate: () => events.push('a:deactivate') })
  api.register({ id: 'b', label: 'b', order: 2, onActivate: () => events.push('b:activate') })
  const dockEl = env.document.body.children[0]
  dockEl.children[1].click()
  assert.deepEqual(events, ['a:deactivate', 'b:activate'])
})

test('a click on the active item still toggles it, without deactivating peers', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  const events = []
  api.register({ id: 'a', label: 'a', order: 1, active: true, onActivate: () => events.push('a:activate'), onDeactivate: () => events.push('a:deactivate') })
  api.register({ id: 'b', label: 'b', order: 2, active: true, onActivate: () => events.push('b:activate'), onDeactivate: () => events.push('b:deactivate') })
  env.document.body.children[0].children[0].click()
  assert.deepEqual(events, ['a:activate'])
})

test('a stale HMR disposer cannot delete the newer registration', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  const stale = api.register({ id: 'ballast', label: 'old', order: 1, onActivate() { } })
  const current = api.register({ id: 'ballast', label: 'new', order: 1, onActivate() { } })
  stale.dispose()
  const dockEl = env.document.body.children[0]
  assert.equal(dockEl.children.length, 1, 'the incumbent registration survives')
  assert.equal(dockEl.children[0].getAttribute('aria-label'), 'new')
  stale.update({ label: 'ghost' })
  assert.equal(dockEl.children[0].getAttribute('aria-label'), 'new', 'a stale update is dropped')
  current.dispose()
  assert.equal(env.document.body.children.length, 0)
})

test('update and dispose act only while the registration owns its id', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  const mine = api.register({ id: 'ballast', label: 'ballast', order: 1, onActivate() { } })
  assert.equal(env.document.body.children[0].children.length, 1)
  mine.update({ label: 'Ballast', active: true })
  assert.equal(env.document.body.children[0].children[0].getAttribute('aria-label'), 'Ballast')
  mine.dispose()
  assert.equal(env.document.body.children.length, 0, 'last item removed tears down the container')
  mine.update({ label: 'ghost' })
  mine.dispose()
})

test('placement defaults to main-bottom-left, persists, and rejects unknown values', () => {
  const env = makeEnv()
  const api = loadDock(env).getUtilityDock()
  assert.equal(api.getPlacement(), 'main-bottom-left')
  api.register(item('ballast'))
  const dockEl = env.document.body.children[0]
  assert.equal(dockEl.style.left, '80px')
  api.setPlacement('main-bottom-right')
  assert.equal(api.getPlacement(), 'main-bottom-right')
  assert.equal(env.store.get('createhelper.utilityDock.placement'), 'main-bottom-right')
  assert.equal(dockEl.style.right, '16px')
  api.setPlacement('top-left-of-doom')
  assert.equal(api.getPlacement(), 'main-bottom-left')
  assert.equal(dockEl.style.right, '')
  assert.equal(dockEl.style.left, '80px')
})

test('a persisted placement is restored by the next creator', () => {
  const env = makeEnv()
  env.store.set('createhelper.utilityDock.placement', 'hidden')
  const api = loadDock(env).getUtilityDock()
  assert.equal(api.getPlacement(), 'hidden')
  api.register(item('ballast'))
  assert.equal(env.document.body.children[0].hidden, true)
})

test('dock chrome CSS is injected once by the creator only', () => {
  const env = makeEnv()
  const dock = loadDock(env)
  dock.getUtilityDock()
  dock.getUtilityDock()
  dock.getUtilityDock()
  const tags = env.document.head.children.filter((el) => el.getAttribute('data-plugin-css') === 'createhelper-utility-dock')
  assert.equal(tags.length, 1)
  assert.ok(tags[0].textContent.includes('.createhelper-utility-dock{'))
})

test('a joiner does not re-inject dock chrome the creator already styled', () => {
  const env = makeEnv()
  const dock = loadDock(env)
  const created = dock.getUtilityDock()
  // Simulate the second plugin's own copy of the module joining the same page.
  const joiner = loadDock(env)
  assert.equal(joiner.getUtilityDock(), created)
  const tags = env.document.head.children.filter((el) => el.getAttribute('data-plugin-css') === 'createhelper-utility-dock')
  assert.equal(tags.length, 1)
})
