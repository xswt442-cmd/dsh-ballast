// The Sidebar Session-row hover seat. Unlike the panel, this component renders
// while the pointer is over a row, so its contract is not only what it shows
// but what it refuses to do: it answers from facts an earlier read already
// cached, and it never starts a host request of its own. This file boots the
// real client bundle in a vm over a real DOM and the real React packages,
// renders the seat, and drives the panel once so the cache holds something the
// host really answered.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOVER_SLOT, OVERLAY_SLOT, UTILITY_ITEM_SLOT, allNodes, bootClient, buttonsIn, settle, textOf
} from './support/client-runtime.js'

// A host that answers the plugin's read shapes with fixed facts.
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

// The hover seat registers its component directly, so a test renders it the
// way the framework would: as an element, never by calling it bare.
const boot = (server) => {
  const client = bootClient({ server })
  const seat = (props) => client.renderSeat(HOVER_SLOT, 'ballast', props)
  return { ...client, seat }
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
  assert.ok(entry(UTILITY_ITEM_SLOT, 'ballast'), 'the launcher menu row is gone')
  assert.ok(entry(OVERLAY_SLOT, 'ballast-panel'), 'the panel is gone')
  assert.ok(entry(OVERLAY_SLOT, 'utility-launcher'), 'the launcher claim is gone')
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
  assert.equal(allNodes(rendered, (node) => node.props.className === 'dshbl-hover-fact').length, 0,
    'with nothing cached there is no summary element')
  assert.deepEqual(fetched, [], 'rendering the seat must not call the host')

  // The seat needs a Session identity; without one it renders nothing rather
  // than a row whose action could not work.
  assert.equal(seat({}), null)
})

// --- cached fact + the action focuses the panel ---------------------------

test('the row repeats a cached measurement, and its action focuses the panel on that session', async () => {
  const { fetched, renderNode, entry, seat } = boot(hostServer())

  // Open the panel the way a user does, so its own read fills the cache.
  const menuTree = renderNode(entry(UTILITY_ITEM_SLOT, 'ballast').render({}))
  buttonsIn(menuTree)[0].props.onClick()
  const panel = entry(OVERLAY_SLOT, 'ballast-panel')
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
