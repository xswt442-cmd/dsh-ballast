// The launcher row and the panel, rendered rather than grepped.
//
// The launcher's seat, the panel's seat, and the disposal path are the browser
// half's whole integration surface, and dsh-mini-utility-dock owns none of it
// beyond the assembly itself: the host places the launcher on the shell overlay
// and the panel on the same layer, so this file pins ballast's side of those two
// seats by clicking them. An `aria-pressed` that flips, a tree that appears and
// then disappears, and a global listener that goes away are the properties that
// matter; a string in the source has never carried any of them.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  OVERLAY_SLOT, UTILITY_ITEM_SLOT, allNodes, bootClient, buttonsIn, byClass, settle, textOf
} from './support/client-runtime.js'

const CLIENT_SRC = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const server = () => ({
  ok: true,
  availability: 'available',
  sessions: [{ sessionId: 'session-a', eventCount: 4, title: 'Alpha', titleSource: 'title' }]
})

const launcher = (client) => client.renderSeat(OVERLAY_SLOT, 'utility-launcher', { renderSlot: client.renderSlot })
const panel = (client) => client.renderSeat(OVERLAY_SLOT, 'ballast-panel')
// Among the launcher menu's buttons only a contributed row reports its own pressed
// state; the launcher's icon reports `aria-expanded`.
const menuRow = (tree) => allNodes(tree, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
const iconButton = (tree) => allNodes(tree, byClass('createhelper-utility-launcher'))[0]
const pressedRow = (tree) => allNodes(tree, (node) => node.type === 'button' && node.props['aria-pressed'] === 'true')
const closeButton = (tree) => allNodes(tree, (node) => node.type === 'button' && node.props.title === 'Close')[0]

test('this plugin contributes exactly one labelled row to the launcher menu', async () => {
  const client = bootClient({ server })
  const seat = client.entry(UTILITY_ITEM_SLOT, 'ballast')
  assert.ok(seat, 'the client contributes no row to the launcher menu seat')
  assert.equal(seat.options.order, 30, 'the row keeps its place in the menu order')
  // A label thunk, not a string: the row has to follow the locale the host moves
  // to after this seat was registered.
  assert.equal(typeof seat.options.label, 'function')
  assert.equal(seat.options.label(), 'Context ballast', 'the label does not resolve through the dictionary')
  assert.equal(seat.options.locale, 'dsh-ballast')

  // The same text, rendered — which is what the label thunk has to survive being.
  const tree = launcher(client)
  const [row] = menuRow(tree)
  assert.ok(row, 'the launcher menu renders no row for this plugin')
  assert.equal(textOf(row), 'Context ballast')
  assert.equal(row.props.title, 'Context ballast')
  assert.equal(menuRow(tree).length, 1, 'this plugin contributes more than one menu row')
})

test('the row opens the panel and marks itself pressed; the close button undoes both', async () => {
  const client = bootClient({ server })

  // Closed: the menu node is present but hidden (a declared child slot is never
  // conditionally declared), and neither the row nor the panel reports open.
  const closed = launcher(client)
  assert.equal(allNodes(closed, byClass('createhelper-utility-menu'))[0].props.hidden, true)
  assert.equal(menuRow(closed)[0].props['aria-pressed'], 'false')
  assert.equal(panel(client), null, 'the panel renders while it is closed')

  // The icon opens the menu; a row is only reachable through it.
  iconButton(closed).props.onClick()
  assert.equal(allNodes(launcher(client), byClass('createhelper-utility-menu'))[0].props.hidden, false)

  // Choosing this plugin's row opens the panel, and the read the mount triggers
  // is the host's own answer reaching the DOM.
  menuRow(launcher(client))[0].props.onClick()
  const opened = panel(client)
  assert.ok(opened, 'the row did not open the panel')
  await settle()
  assert.ok(client.fetched.some((url) => url.includes('action=sessions')),
    'the mounted panel never asked the host for its sessions')
  assert.match(textOf(allNodes(panel(client), byClass('dshbl-title'))[0]), /ballast/)
  assert.equal(menuRow(launcher(client))[0].props['aria-pressed'], 'true',
    'an open panel must show its own row pressed')

  // Closing is the same state the row set, so the same two facts must invert.
  closeButton(panel(client)).props.onClick()
  assert.equal(panel(client), null, 'the close button left the panel mounted')
  assert.equal(menuRow(launcher(client))[0].props['aria-pressed'], 'false')
})

// Unmount has to give back everything the mount took: the panel listens on the
// document while it is open, and a listener left behind by a closed panel would
// dismiss or act on a surface the user is no longer looking at.
test('unmounting the panel drops its document listeners', async () => {
  const client = bootClient({ server })
  menuRow(launcher(client))[0].props.onClick()
  panel(client)
  await settle()
  assert.ok(client.document.listeners.some((item) => item.type === 'pointerdown'),
    'an open panel registers no dismiss listener')

  closeButton(panel(client)).props.onClick()
  assert.equal(panel(client), null)
  assert.deepEqual(client.document.listeners.filter((item) => item.type === 'pointerdown'), [],
    'the closed panel left its dismiss listener on the document')
})

// The dismiss listener's boundary is an attribute, and it has to be one the
// launcher actually writes: the wrapper it marks as its own anchor. Matching an
// attribute nothing in the page sets turns every press on the launcher icon into a
// click outside the panel, which closes the panel the press just opened.
test('a press on the launcher does not close the panel it opened', async () => {
  const client = bootClient({ server })
  const press = (target) => client.react.act(() => {
    target.dispatchEvent(new client.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  })

  menuRow(launcher(client))[0].props.onClick()
  panel(client)
  await settle()

  // Anywhere else on the page is the dismissal the listener exists for.
  press(client.document.body)
  assert.equal(panel(client), null, 'a press outside the panel left it open')

  menuRow(launcher(client))[0].props.onClick()
  panel(client)
  await settle()
  const anchor = client.document.querySelector('[data-utility-anchor]')
  assert.ok(anchor, 'the launcher writes no anchor attribute for the panel to exclude')
  press(anchor.querySelector('.createhelper-utility-launcher'))
  assert.ok(panel(client), 'a press on the launcher closed the panel it opened')
})

// The plugin-level dispose is the shell unloading the whole bundle: the panel
// must go, its stylesheet must go, and the launcher claim must go with it so a
// later copy of the launcher assembly can take the mutex.
test('disposing the plugin unmounts the panel, drops its stylesheet and releases the launcher', async () => {
  const client = bootClient({ server })
  menuRow(launcher(client))[0].props.onClick()
  panel(client)
  await settle()
  assert.ok(client.document.hasStyle('dsh-ballast'), 'the mounted plugin injected no stylesheet')
  const claim = client.window.__CREATEHELPER_DSH_UTILITY_LAUNCHER_V1__
  assert.ok(claim.owner, 'this plugin never owned the launcher claim')

  await client.dispose()

  assert.equal(panel(client), null, 'the panel survived the plugin being disposed')
  assert.equal(client.document.hasStyle('dsh-ballast'), false, 'the stylesheet outlived the plugin')
  assert.equal(claim.owner, null, 'the launcher claim stayed taken by a disposed owner')
})

// The one property that is about the file rather than the runtime: the launcher
// assembly is the dock fragment, marked for `launcher:sync`, and not a hand-kept
// copy. `launcher:check` compares its bytes; this says it is the block at all.
test('the launcher assembly is the marked dock fragment', () => {
  assert.match(CLIENT_SRC, /\/\/ <dsh-utility-launcher>[\s\S]*\/\/ <\/dsh-utility-launcher>/)
  assert.equal(CLIENT_SRC.split('// <dsh-utility-launcher>').length - 1, 1)
  assert.equal(CLIENT_SRC.split('// </dsh-utility-launcher>').length - 1, 1)
})

// The plugin shape the shell loads: the definition's factory returns an object
// with `apply`, and booting it is what registers every seat above. Asserted on the
// loaded module, so a bundle that hands back something else fails here rather than
// failing to match a regex.
test('the loaded definition applies as a plugin', () => {
  const { definition, plugin } = bootClient({ server })
  assert.equal(typeof definition.factory, 'function')
  assert.equal(typeof plugin, 'object')
  assert.equal(typeof plugin.apply, 'function')
})

test('the launcher tree holds the icon and this plugin\'s row and nothing else', () => {
  const client = bootClient({ server })
  assert.equal(buttonsIn(launcher(client)).length, 2, 'unexpected buttons in the launcher menu')
})
