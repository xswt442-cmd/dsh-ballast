// 浏览器端的注册面，按真实方式验证：`lib/client.js` 按宿主经典 <script>
// 的方式求值，插件交给 shell 的东西再从 shell 读回来。对源码做文本匹配时，
// 标识符只出现在注释里也会通过；这里的断言只有在 bundle 启动、注册席位并
// 读取自己的路由时才成立。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OVERLAY_SLOT, UTILITY_ITEM_SLOT, HOVER_SLOT, allNodes, bootClient, byClass, settle, textOf
} from './support/client-runtime.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// 一个对三种读取形状都作答的宿主，测试因此能把面板驱动到每个视图，并观察
// 它请求了什么。
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
      // 作答进程的身份，由路由报告。
      pid: 4242,
      port: 19387,
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
  // 沙箱里没有 `require`、`module`、`exports`、`process` 和 ESM 加载器，
  // 这就是浏览器给 bundle 的形状。`import` 在这里是语法错误，Node 内置模块
  // 会落到未定义的名字——两者都会让这个测试失败，而不是让文本匹配通过。
  const { sandbox, definition } = bootClient()
  for (const name of ['require', 'module', 'exports', 'process', '__dirname']) {
    assert.equal(sandbox[name], undefined, `the sandbox leaked ${name} into the client runtime`)
  }
  assert.equal(definition.id, pkg.name)
})

test('the client joins the launcher menu instead of a page-local dock', () => {
  const { entry, registered, window } = bootClient()
  // 启动器菜单上的一行，由本插件贡献……
  const row = entry(UTILITY_ITEM_SLOT, 'ballast')
  assert.ok(row, 'the client contributes no row to the launcher menu seat')
  assert.equal(typeof row.render, 'function')
  // ……以及启动器本身，认领在 shell 的 overlay 层上。
  assert.ok(entry(OVERLAY_SLOT, 'utility-launcher'), 'the client never claimed the launcher')
  assert.ok(entry(OVERLAY_SLOT, 'ballast-panel'), 'the panel is not on the overlay layer')
  assert.ok(entry(HOVER_SLOT, 'ballast'), 'the session row seat is gone')

  // 认领就是启动器的页面互斥：持有它才保证每页只运行一份装配。页面里没有
  // 第二个 dock 键参与协调。
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

  // 按用户的方式打开面板：本插件贡献的启动器菜单行。
  const menu = client.renderSeat(OVERLAY_SLOT, 'utility-launcher', { renderSlot: client.renderSlot })
  const [row] = allNodes(menu, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
  assert.ok(row, 'the launcher menu renders no row for this plugin')
  row.props.onClick()

  panel()
  await settle()
  assert.ok(client.fetched.length > 0, 'an opened panel read nothing')

  // 跨会话视图是第三种路由形状；没有这次点击，`top` 请求永远不会离开面板，
  // 也就不会被检查。面板自己的按钮里只有视图开关报告按下状态。
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

// 作答进程的身份是快照的一部分，不是装饰：两个 DSH 宿主可以服务同一个数据
// 目录，而面板只列出作答进程里活着的会话。头部只显示一个数字，会诱导读者
// 把另一个宿主的会话加进来。
test('the panel header names the host process that answered', async () => {
  const client = bootClient({ server: server() })
  const panel = () => client.renderSeat(OVERLAY_SLOT, 'ballast-panel')
  const menu = client.renderSeat(OVERLAY_SLOT, 'utility-launcher', { renderSlot: client.renderSlot })
  const [row] = allNodes(menu, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
  row.props.onClick()
  panel()
  await settle()

  const [identity] = allNodes(panel(), byClass('dshbl-hostproc'))
  assert.ok(identity, 'the panel header does not name the host process')
  assert.equal(textOf(identity), 'pid 4242 · port 19387')

  // 跨会话视图显示的计数来自同一个进程的活跃会话。
  const [hostView] = allNodes(panel(), (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
  hostView.props.onClick()
  await settle()
  const [count] = allNodes(panel(), byClass('dshbl-count'))
  assert.equal(textOf(count), '1 sessions in this host process')
})
