// Sidebar Session 行的悬停席位。与面板不同，这个组件在指针悬停到行上时
// 渲染，所以它的约定不只是显示什么，还包括拒绝做什么：它从先前读取已缓存的
// 事实作答，绝不自己发起宿主请求。本文件在 vm 中用真实 DOM 与真实 React 包
// 启动客户端 bundle，渲染席位，并驱动面板一次，让缓存里持有宿主真实返回的
// 内容。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOVER_SLOT, OVERLAY_SLOT, UTILITY_ITEM_SLOT, allNodes, bootClient, buttonsIn, settle, textOf
} from './support/client-runtime.js'

// 一个用固定事实回答插件读取形状的宿主。
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

// 悬停席位直接注册组件，测试按框架的方式渲染它：作为元素，绝不裸调用。
const boot = (server) => {
  const client = bootClient({ server })
  const seat = (props) => client.renderSeat(HOVER_SLOT, 'ballast', props)
  return { ...client, seat }
}

// --- 席位注册 ------------------------------------------------------------

test('the seat registers on the Sidebar Session row hover card with this plugin id', () => {
  const { registered, entry } = boot(() => ({ ok: false }))
  const hover = entry(HOVER_SLOT, 'ballast')
  assert.ok(hover, 'the hover seat is never registered')
  assert.equal(typeof hover.options.order, 'number')
  assert.ok(hover.options.order > 0 && hover.options.order < 100,
    'the seat keeps a small order so it stays inside the hover card')
  assert.notEqual(hover.options.order, 10, 'the shipped schedule section owns order 10')
  // 已有的注册没有被改动。
  assert.ok(entry(UTILITY_ITEM_SLOT, 'ballast'), 'the launcher menu row is gone')
  assert.ok(entry(OVERLAY_SLOT, 'ballast-panel'), 'the panel is gone')
  assert.ok(entry(OVERLAY_SLOT, 'utility-launcher'), 'the launcher claim is gone')
  assert.ok(registered.every((item) => item.options.name !== HOVER_SLOT || item.options.id === 'ballast'),
    'this plugin contributes exactly one row to the seat')
})

// --- 没有缓存事实：动作与零数字 ------------------------------------------

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

  // 席位需要 Session 身份；没有身份时渲染空，而不是渲染一个动作无法执行的
  // 行。
  assert.equal(seat({}), null)
})

// --- 有缓存事实：动作让面板定位到该会话 ----------------------------------

test('the row repeats a cached measurement, and its action focuses the panel on that session', async () => {
  const { fetched, renderNode, entry, seat } = boot(hostServer())

  // 像用户一样打开面板，让它自己的读取填充缓存。
  const menuTree = renderNode(entry(UTILITY_ITEM_SLOT, 'ballast').render({}))
  buttonsIn(menuTree)[0].props.onClick()
  const panel = entry(OVERLAY_SLOT, 'ballast-panel')
  renderNode(panel.render())
  await settle()
  assert.ok(fetched.includes('/dsh-ballast/api?action=measure&sessionId=session-a'),
    'the panel should have measured the session it selected')

  const readsAfterPanel = fetched.length

  // 已计量的会话显示数字，来自缓存。
  const measured = seat({ sessionId: 'session-a' })
  assert.match(textOf(measured), /surface 1,234 · heaviest #7 900/)
  assert.match(textOf(measured), /Show breakdown/)

  // 只被列出、尚未计量的会话没有 token 数字，所以不显示——只有列表真正
  // 携带的日志长度。
  const listed = seat({ sessionId: 'session-b' })
  assert.equal(textOf(listed), 'log 3 eventsShow breakdown')
  assert.doesNotMatch(textOf(listed), /surface|heaviest/, 'an unmeasured session gets no token figure')

  assert.equal(fetched.length, readsAfterPanel, 'rendering cached rows must not call the host')

  // 动作以 session-b 为目标，而它不是已打开面板选中的会话：只有真实的定位
  // 路径才能产生那个 measure 请求。
  allNodes(listed, (node) => node.type === 'button')[0].props.onClick()
  renderNode(panel.render())
  await settle()
  const measures = fetched.filter((url) => url.includes('action=measure'))
  assert.equal(measures[measures.length - 1], '/dsh-ballast/api?action=measure&sessionId=session-b',
    'the action must open the panel focused on the row sessionId')

  // 已计量行自己的动作把面板移回去：无论该行有没有缓存事实，入口都能用。
  allNodes(measured, (node) => node.type === 'button')[0].props.onClick()
  renderNode(panel.render())
  await settle()
  const after = fetched.filter((url) => url.includes('action=measure'))
  assert.equal(after[after.length - 1], '/dsh-ballast/api?action=measure&sessionId=session-a')
})
