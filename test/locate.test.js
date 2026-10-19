// 行上的定位按钮：滚动到聊天窗口里的那一条并高亮它。
//
// 这些 DOM 属性是宿主的内部约定，不是公开 API，所以这里固定的是「宿主换了
// 形状时会发生什么」：定位不上就什么也不做，行照常显示，异常不冒泡到面板
// 渲染。测试在 vm 中用真实 DOM 与真实 React 包启动 bundle，构造宿主的聊天
// 标记，再点真实的按钮。

import test from 'node:test'
import assert from 'node:assert/strict'
import { chatIdentityOf } from '../lib/preview.js'
import { shapeMeasurement } from '../lib/meter.js'
import {
  OVERLAY_SLOT, UTILITY_ITEM_SLOT, allNodes, bootClient, buttonsIn, byClass, settle, textOf
} from './support/client-runtime.js'

// ---- 宿主形状 ------------------------------------------------------------

/**
 * 往页面里放一个主聊天列。
 *
 * 层级就是宿主的层级：`main.conversation` 是 `conversation.view` 的祖先，
 * 两者又都是 `data-chat-flow` 的祖先，所以它就是插件查找的那个元素。会话 id
 * 挂在 `[data-conversation-session]` 上，插件据此判断当前显示的是不是被测
 * 会话。
 */
function chatColumn(owner, sessionId) {
  const main = owner.document.createElement('div')
  main.setAttribute('data-slot', 'main.conversation')
  const content = owner.document.createElement('div')
  content.setAttribute('data-conversation-content', '')
  content.setAttribute('data-conversation-session', sessionId)
  content.setAttribute('data-slot', 'conversation.view')
  const scroller = owner.document.createElement('div')
  scroller.setAttribute('data-conversation-scroll', '')
  // 滚动容器在真实浏览器里有一个视口大小的盒子，插件据此判断目标是否已经
  // 在可见区域内。happy-dom 没有布局引擎，所以这里给出浏览器的答案。
  scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1024, bottom: 768, width: 1024, height: 768 })
  const flow = owner.document.createElement('div')
  flow.setAttribute('data-chat-flow', '')
  scroller.appendChild(flow)
  content.appendChild(scroller)
  main.appendChild(content)
  owner.document.body.appendChild(main)
  return { main, content, scroller, flow }
}

/**
 * 往列里放一个聊天条目。
 *
 * `box` 是这个条目向插件报告的盒子尺寸：真实浏览器里由布局给出，happy-dom
 * 没有布局引擎，所以测试自己给出。没有盒子就是还没有渲染出来——插件必须
 * 跳过它，而不是把用户带到空白处。
 */
function chatNode(owner, flow, attrs, box) {
  const node = owner.document.createElement('div')
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  node.getBoundingClientRect = () => (box
    ? { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }
    : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })
  flow.appendChild(node)
  return node
}

/**
 * 把一个条目挪到视口之外，于是定位必须先滚动才能看到它。
 *
 * `scrollIntoView` 记录调用之后把这个条目挪回视口内——真实浏览器里滚动正是
 * 这样改变布局的，否则滚动之后目标仍然在屏幕外，高亮层会落在空处。
 */
function offscreen(node, scrolled) {
  const away = { left: 0, top: 900, right: 400, bottom: 1100, width: 400, height: 200 }
  const inside = { left: 0, top: 300, right: 400, bottom: 500, width: 400, height: 200 }
  let scrolledInto = false
  node.getBoundingClientRect = () => (scrolledInto ? inside : away)
  node.scrollIntoView = (options) => {
    scrolledInto = true
    scrolled.push(options)
  }
  return node
}

// ---- 宿主读取 ------------------------------------------------------------

// 三种 surface 事件的真实身份。nodeKey 的格式由宿主的 conversationContextKey
// 决定，所以断言完整字符串，而不是断言「有一个字符串」。
const ROWS = [
  { seq: 7, type: 'assistant/message', tokens: 900, chat: { nodeKey: '14:assistant-step1:1', turn: 1 } },
  { seq: 5, type: 'user/message', tokens: 334, chat: { nodeKey: '13:input-messagemsg-7', turn: null } },
  { seq: 9, type: 'tool/result', tokens: 120, chat: { nodeKey: '9:tool-callcall-3', turn: 1 } }
]

function measurementWith(rows) {
  return {
    logRevision: 12, eventCount: 12, totalTokens: 1354, surfaceTokens: 1354,
    nodeCount: rows.length, shadowPricing: 'unknown', routePricedCount: 0, unpricedCount: 0,
    byType: { total: 1354, types: [] },
    rows
  }
}

function hostServer(rows = ROWS) {
  return (url) => {
    if (url.includes('action=sessions')) {
      return {
        ok: true,
        availability: 'available',
        sessions: [{ sessionId: 'session-a', eventCount: 12, title: 'Alpha', titleSource: 'title' }]
      }
    }
    if (url.includes('action=measure')) {
      return {
        ok: true,
        sessionId: 'session-a',
        title: 'Alpha',
        titleSource: 'title',
        measurement: measurementWith(rows),
        projections: null
      }
    }
    return { ok: false, code: 'bad_action' }
  }
}

// 像用户一样打开面板并等它的读取落地，交回面板当前这次渲染。
async function openPanel(client) {
  const menu = client.renderNode(client.entry(UTILITY_ITEM_SLOT, 'ballast').render({}))
  buttonsIn(menu)[0].props.onClick()
  const panel = client.entry(OVERLAY_SLOT, 'ballast-panel')
  client.renderNode(panel.render())
  await settle()
  return () => client.renderNode(panel.render())
}

// 面板行末尾的定位按钮。
const locateButtons = (tree) => allNodes(tree, byClass('dshbl-locate'))
const rowsOf = (tree) => allNodes(tree, byClass('dshbl-row'))
const flashes = (client) => client.document.querySelectorAll('.dshbl-chatflash')

/**
 * 等滚动结束之后的那层高亮出现。
 *
 * 插件在滚动落定之后才加高亮（真实浏览器里平滑滚动不是同步的），所以这里推进
 * 真实时间，而不是只冲刷宏任务。
 */
async function afterScroll(client) {
  await settle()
  await client.react.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320))
  })
}

// ---- 宿主侧身份 ----------------------------------------------------------

test('the host derives the chat identity each surface event is rendered under', () => {
  assert.deepEqual(
    chatIdentityOf({ type: 'user/message', data: { id: 'msg-7' } }),
    { nodeKey: '13:input-messagemsg-7', turn: null }
  )
  assert.deepEqual(
    chatIdentityOf({ type: 'assistant/message', data: { turn: 1, step: 1 } }),
    { nodeKey: '14:assistant-step1:1', turn: 1 }
  )
  assert.deepEqual(
    chatIdentityOf({ type: 'tool/result', data: { turn: 2, message: { source: { kind: 'tool', callId: 'call-3' } } } }),
    { nodeKey: '9:tool-callcall-3', turn: 2 }
  )
})

test('an event with no locatable identity carries none at all', () => {
  // 半个身份会让定位落在一个错误的条目上，那比没有入口更糟。
  for (const event of [
    null,
    {},
    { type: 'user/message' },
    { type: 'user/message', data: { id: '' } },
    { type: 'user/message', data: { id: 7 } },
    { type: 'assistant/message', data: { turn: 1 } },
    { type: 'tool/result', data: { message: {} } },
    { type: 'tool/result', data: { message: { source: { callId: '' } } } },
    { type: 'session/title', data: { title: 'x' } }
  ]) {
    assert.equal(chatIdentityOf(event), null, `${JSON.stringify(event)} has no chat identity`)
  }
})

test('a row whose event is missing carries no chat identity', () => {
  const out = shapeMeasurement({ nodes: [{ seq: 99, tokens: 5, heuristicTokens: 5 }] }, { id: 'x' })
  assert.equal(out.rows[0].type, null)
  assert.equal(out.rows[0].chat, null, 'an unreadable event cannot claim a chat entry')
})

// ---- 渲染条件 ------------------------------------------------------------

test('the locate button appears only while the chat shows the measured session', async () => {
  const client = bootClient({ server: hostServer() })
  // 聊天显示的正是被测会话。
  const { content } = chatColumn(client, 'session-a')
  const panel = await openPanel(client)
  assert.equal(locateButtons(panel()).length, ROWS.length,
    'every measurable row offers a locate action while the chat shows that session')

  // 宿主切换到另一个会话：入口整个消失，而不是指向另一个会话的窗口。
  content.setAttribute('data-conversation-session', 'session-other')
  assert.equal(locateButtons(panel()).length, 0,
    'locating into another session would highlight an unrelated entry')
})

test('no chat window means no locate button, and rows still render', async () => {
  const client = bootClient({ server: hostServer() })
  const panel = await openPanel(client)
  assert.equal(rowsOf(panel()).length, ROWS.length, 'the rows must render without a chat window')
  assert.equal(locateButtons(panel()).length, 0)
})

test('a row with no identity renders no button inside a locatable chat', async () => {
  const client = bootClient({ server: hostServer([{ seq: 99, type: null, tokens: 5, chat: null }]) })
  chatColumn(client, 'session-a')
  const panel = await openPanel(client)
  const tree = panel()
  assert.equal(rowsOf(tree).length, 1)
  assert.equal(locateButtons(tree).length, 0, 'a row with no identity must offer no locate action')
})

// ---- 点击定位 ------------------------------------------------------------

test('clicking locate scrolls to that entry and highlights it', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow } = chatColumn(client, 'session-a')
  const scrolled = []
  // 目标在视口之外，所以定位必须滚动才能看到它。
  offscreen(chatNode(client, flow, { 'data-chat-node-key': ROWS[1].chat.nodeKey }, true), scrolled)

  const panel = await openPanel(client)
  const before = client.fetched.length
  locateButtons(panel())[1].props.onClick()
  await afterScroll(client)

  assert.equal(client.fetched.length, before, 'locating must not call the host')
  assert.equal(scrolled.length, 1, 'an offscreen target must be scrolled to')
  assert.equal(scrolled[0].block, 'center')
  const [flash] = flashes(client)
  assert.ok(flash, 'locating flashes the entry it scrolled to')
  assert.match(flash.style.left, /px$/)
  assert.match(flash.style.height, /px$/)
})

test('locating picks the first rendered candidate, skipping the ones without a box', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow } = chatColumn(client, 'session-a')
  // 同一个身份出现两次：前一个还没有盒子（虚拟化占位或懒渲染），后一个已经
  // 渲染。盲取第一个会把用户带到空白处。
  chatNode(client, flow, { 'data-chat-node-key': ROWS[0].chat.nodeKey }, false)
  const scrolled = []
  offscreen(chatNode(client, flow, { 'data-chat-node-key': ROWS[0].chat.nodeKey }, true), scrolled)

  const panel = await openPanel(client)
  locateButtons(panel())[0].props.onClick()
  await afterScroll(client)

  assert.equal(scrolled.length, 1, 'only the rendered candidate may be scrolled to')
  assert.equal(flashes(client).length, 1)
})

test('an entry with several candidates in one turn falls back to the turn', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow } = chatColumn(client, 'session-a')
  // 精确身份不存在于窗口里（宿主换过 key 规则），但同一个 turn 里有候选：
  // 定位到这一轮仍然比什么都不做有用。
  const scrolled = []
  offscreen(chatNode(client, flow, { 'data-chat-turn': '1' }, true), scrolled)

  const panel = await openPanel(client)
  locateButtons(panel())[0].props.onClick()
  await afterScroll(client)

  assert.equal(scrolled.length, 1, 'the turn is the fallback when the exact key is absent')
})

test('a hidden candidate is woken with beforematch rather than by editing the host', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow, scroller } = chatColumn(client, 'session-a')
  const collapsed = client.document.createElement('div')
  collapsed.setAttribute('hidden', 'until-found')
  const scrolled = []
  collapsed.appendChild(offscreen(chatNode(client, flow, { 'data-chat-node-key': ROWS[0].chat.nodeKey }, true), scrolled))
  flow.appendChild(collapsed)

  const events = []
  scroller.addEventListener('beforematch', () => events.push('scroll'))
  collapsed.addEventListener('beforematch', () => events.push('collapsed'))

  const panel = await openPanel(client)
  locateButtons(panel())[0].props.onClick()
  await afterScroll(client)

  assert.deepEqual(events, ['scroll', 'collapsed'])
  assert.equal(collapsed.getAttribute('hidden'), 'until-found',
    'the plugin must not change the attribute the host owns')
})

test('locating an entry the chat no longer holds does nothing at all', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow } = chatColumn(client, 'session-a')
  // 窗口里没有这一条：宿主换了属性，或这一段已被压缩掉。
  chatNode(client, flow, { 'data-chat-node-key': '13:input-messagemsg-other' }, true)

  const panel = await openPanel(client)
  const before = client.fetched.length
  locateButtons(panel())[1].props.onClick()
  await afterScroll(client)

  assert.equal(flashes(client).length, 0)
  assert.equal(client.fetched.length, before)
  assert.equal(rowsOf(panel()).length, ROWS.length, 'the rows still render after a failed locate')
})

test('an entry that is present but not rendered is skipped, not scrolled to', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow } = chatColumn(client, 'session-a')
  // 条目在 DOM 里，但还没有盒子：虚拟化的占位，或还没被懒渲染叫醒的内容。
  const scrolled = []
  const pending = chatNode(client, flow, { 'data-chat-node-key': ROWS[0].chat.nodeKey }, false)
  pending.scrollIntoView = (options) => { scrolled.push(options) }

  const panel = await openPanel(client)
  locateButtons(panel())[0].props.onClick()
  await afterScroll(client)

  assert.equal(scrolled.length, 0, 'scrolling to an unrendered node would land on blank space')
  assert.equal(flashes(client).length, 0)
})

// ---- 跨版本与可达性 ------------------------------------------------------

test('a host whose DOM lookups throw leaves the panel untouched', async () => {
  const client = bootClient({ server: hostServer() })
  // querySelectorAll 抛出的宿主形状（分离的文档、被扩展改写的原型）不能让面板
  // 渲染失败：这些属性是内部约定，定位不上只是没有定位。
  client.document.querySelectorAll = () => { throw new Error('detached document') }
  const panel = await openPanel(client)
  const tree = panel()
  assert.equal(rowsOf(tree).length, ROWS.length, 'rows must still render')
  assert.equal(locateButtons(tree).length, 0, 'without a readable chat there is no locate action')
})

test('the locate button is a real button with an accessible name', async () => {
  const client = bootClient({ server: hostServer() })
  chatColumn(client, 'session-a')
  const panel = await openPanel(client)
  const [first] = locateButtons(panel())
  assert.equal(first.type, 'button', 'the action must be reachable by keyboard')
  assert.equal(first.props.type, 'button', 'a submit button would reload the page')
  assert.equal(first.props['aria-label'], 'Locate #7 in the chat')
  assert.equal(textOf(first), 'Locate')
})

test('reduced motion scrolls straight to the entry and skips the flash', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow } = chatColumn(client, 'session-a')
  const scrolled = []
  offscreen(chatNode(client, flow, { 'data-chat-node-key': ROWS[0].chat.nodeKey }, true), scrolled)
  client.window.matchMedia = (query) => ({ matches: query.includes('reduce') })

  const panel = await openPanel(client)
  locateButtons(panel())[0].props.onClick()
  await afterScroll(client)

  assert.equal(scrolled[0].behavior, 'instant')
  assert.equal(flashes(client).length, 0)
})

test('an already visible entry is flashed without scrolling to it', async () => {
  const client = bootClient({ server: hostServer() })
  const { flow } = chatColumn(client, 'session-a')
  const scrolled = []
  const target = chatNode(client, flow, { 'data-chat-node-key': ROWS[0].chat.nodeKey }, true)
  target.scrollIntoView = (options) => { scrolled.push(options) }

  const panel = await openPanel(client)
  locateButtons(panel())[0].props.onClick()
  await afterScroll(client)

  assert.equal(scrolled.length, 0, 'an entry already on screen needs no scrolling')
  assert.equal(flashes(client).length, 1, 'it still gets highlighted')
})