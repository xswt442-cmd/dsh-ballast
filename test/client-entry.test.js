// The browser half's registration surface, exercised for real: `lib/client.js` is
// evaluated the way the host's classic <script> evaluates it, and what the plugin
// handed the shell is read back off the shell. A grep over the source passes when
// an identifier appears only in a comment; these pass only when the bundle boots,
// registers its seats, and reads from the route it owns.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OVERLAY_SLOT, UTILITY_ITEM_SLOT, HOVER_SLOT, allNodes, bootClient, settle
} from './support/client-runtime.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// A host that answers all three read shapes, so a test can drive the panel into
// every view it has and watch what it asks for.
function server() {
  return (url) => {
    if (url.includes('action=measure')) {
      return {
        ok: true,
        sessionId: 'session-a',
        title: 'Alpha',
        titleSource: 'title',
        measurement: {
          logRevision: 4, eventCount: 4, totalTokens: 900, surfaceTokens: 900, nodeCount: 1,
          rows: [{ seq: 3, type: 'assistant/message', tokens: 900 }]
        },
        projections: null
      }
    }
    if (url.includes('action=top')) {
      return {
        ok: true,
        limit: 5,
        failedCount: 0,
        failures: [],
        sessions: [{ sessionId: 'session-a', title: 'Alpha', titleSource: 'title', nodeCount: 1, surfaceTokens: 900, rows: [{ seq: 3, type: 'assistant/message', tokens: 900 }] }]
      }
    }
    return {
      ok: true,
      availability: 'available',
      sessions: [{ sessionId: 'session-a', eventCount: 4, title: 'Alpha', titleSource: 'title' }]
    }
  }
}

test('the bundle registers under the package name', () => {
  const { definition } = bootClient()
  assert.equal(definition.id, pkg.name, 'the client bundle id must match the package name')
  assert.equal(typeof definition.factory, 'function')
})

test('the artifact is a classic script: it boots where Node globals do not exist', () => {
  // The sandbox has no `require`, `module`, `exports`, `process` and no ESM
  // loader, so this is the shape the browser gives the bundle. An `import` line is
  // a SyntaxError here and a Node builtin reaches an undefined name — either one
  // fails this test rather than passing a regex over the text.
  const { sandbox, definition } = bootClient()
  for (const name of ['require', 'module', 'exports', 'process', '__dirname']) {
    assert.equal(sandbox[name], undefined, `the sandbox leaked ${name} into the client runtime`)
  }
  assert.equal(definition.id, pkg.name)
})

test('the client joins the launcher menu instead of a page-local dock', () => {
  const { entry, registered, window } = bootClient()
  // One row on the launcher menu seat, contributed by this plugin...
  const row = entry(UTILITY_ITEM_SLOT, 'ballast')
  assert.ok(row, 'the client contributes no row to the launcher menu seat')
  assert.equal(typeof row.render, 'function')
  // ...and the launcher itself, claimed on the shell's overlay layer.
  assert.ok(entry(OVERLAY_SLOT, 'utility-launcher'), 'the client never claimed the launcher')
  assert.ok(entry(OVERLAY_SLOT, 'ballast-panel'), 'the panel is not on the overlay layer')
  assert.ok(entry(HOVER_SLOT, 'ballast'), 'the session row seat is gone')

  // The claim is the launcher's page mutex: owning it is what makes one copy of
  // the assembly run per page. The retired page-local dock protocol must not be
  // what created it.
  const claim = window.__CREATEHELPER_DSH_UTILITY_LAUNCHER_V1__
  assert.ok(claim && typeof claim === 'object', 'the launcher claim was never taken')
  assert.equal(claim.owner !== null, true, 'the launcher claim is empty after this plugin registered it')
  assert.equal(window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__, undefined, 'the retired dock key is back')
  const seats = new Set(registered.map((item) => item.options.name))
  assert.deepEqual([...seats].sort(), [UTILITY_ITEM_SLOT, 'shell.overlay', HOVER_SLOT].sort(),
    'the client registers on a seat no shell owns')
})

test('every read the panel makes goes to this plugin\'s own same-origin route', async () => {
  const client = bootClient({ server: server() })
  const panel = () => client.renderSeat(OVERLAY_SLOT, 'ballast-panel')

  // Open it the way a user does: the launcher menu row this plugin contributed.
  const menu = client.renderSeat(OVERLAY_SLOT, 'utility-launcher', { renderSlot: client.renderSlot })
  const [row] = allNodes(menu, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
  assert.ok(row, 'the launcher menu renders no row for this plugin')
  row.props.onClick()

  panel()
  await settle()
  assert.ok(client.fetched.length > 0, 'an opened panel read nothing')

  // The cross-session view is the third route shape; without this click the
  // `top` request would never leave the panel and never be checked. Among the
  // panel's own buttons only the view toggle reports a pressed state.
  const [hostView] = allNodes(panel(), (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
  assert.ok(hostView, 'the panel renders no control to switch view')
  hostView.props.onClick()
  await settle()

  for (const url of client.fetched) {
    assert.ok(url.startsWith('/dsh-ballast/api'), `the client asked a foreign URL: ${url}`)
  }
  assert.ok(client.fetched.some((url) => url.includes('action=measure')), 'the panel never measured a session')
  assert.ok(client.fetched.some((url) => url.includes('action=top')), 'the panel never ran the cross-session scan')
})
