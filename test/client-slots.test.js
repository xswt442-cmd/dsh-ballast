// 启动器行与面板，按渲染结果验证，而不是对源码做文本匹配。
//
// 启动器的席位、面板的席位与销毁路径是浏览器端的全部集成面，
// dsh-mini-utility-dock 除装配本身之外不拥有这些：宿主把启动器放在 shell
// overlay 上，面板放在同一层，所以本文件通过点击来固定 ballast 在这两个席位
// 上的行为。`aria-pressed` 翻转、树出现后消失、全局监听器被移除，才是关键
// 属性；源码里的一个字符串从来不代表这些。

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
// 启动器菜单的按钮里，只有贡献的行报告自己的按下状态；启动器图标报告的是
// `aria-expanded`。
const menuRow = (tree) => allNodes(tree, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
const iconButton = (tree) => allNodes(tree, byClass('createhelper-utility-launcher'))[0]
const pressedRow = (tree) => allNodes(tree, (node) => node.type === 'button' && node.props['aria-pressed'] === 'true')
const closeButton = (tree) => allNodes(tree, (node) => node.type === 'button' && node.props.title === 'Close')[0]

test('this plugin contributes exactly one labelled row to the launcher menu', async () => {
  const client = bootClient({ server })
  const seat = client.entry(UTILITY_ITEM_SLOT, 'ballast')
  assert.ok(seat, 'the client contributes no row to the launcher menu seat')
  assert.equal(seat.options.order, 30, 'the row keeps its place in the menu order')
  // 标签是 thunk 而不是字符串：这一行必须跟随宿主在此席位注册之后切换到的
  // 语言。
  assert.equal(typeof seat.options.label, 'function')
  assert.equal(seat.options.label(), 'Context ballast', 'the label does not resolve through the dictionary')
  assert.equal(seat.options.locale, 'dsh-ballast')

  // 同样的文本，按渲染结果验证——标签 thunk 必须经得起渲染。
  const tree = launcher(client)
  const [row] = menuRow(tree)
  assert.ok(row, 'the launcher menu renders no row for this plugin')
  assert.equal(textOf(row), 'Context ballast')
  assert.equal(row.props.title, 'Context ballast')
  assert.equal(menuRow(tree).length, 1, 'this plugin contributes more than one menu row')
})

test('the row opens the panel and marks itself pressed; the close button undoes both', async () => {
  const client = bootClient({ server })

  // 关闭时：菜单节点存在但隐藏（已声明的子槽不会按条件声明），行与面板都
  // 不报告打开。
  const closed = launcher(client)
  assert.equal(allNodes(closed, byClass('createhelper-utility-menu'))[0].props.hidden, true)
  assert.equal(menuRow(closed)[0].props['aria-pressed'], 'false')
  assert.equal(panel(client), null, 'the panel renders while it is closed')

  // 图标打开菜单；行只有通过菜单才能到达。
  iconButton(closed).props.onClick()
  assert.equal(allNodes(launcher(client), byClass('createhelper-utility-menu'))[0].props.hidden, false)

  // 选择本插件的行打开面板，挂载触发的读取是宿主的答案真正到达 DOM。
  menuRow(launcher(client))[0].props.onClick()
  const opened = panel(client)
  assert.ok(opened, 'the row did not open the panel')
  await settle()
  assert.ok(client.fetched.some((url) => url.includes('action=sessions')),
    'the mounted panel never asked the host for its sessions')
  assert.match(textOf(allNodes(panel(client), byClass('dshbl-title'))[0]), /ballast/)
  assert.equal(menuRow(launcher(client))[0].props['aria-pressed'], 'true',
    'an open panel must show its own row pressed')

  // 关闭设置的是同一个状态，所以同样的两件事必须一起翻转。
  closeButton(panel(client)).props.onClick()
  assert.equal(panel(client), null, 'the close button left the panel mounted')
  assert.equal(menuRow(launcher(client))[0].props['aria-pressed'], 'false')
})

// 卸载必须归还挂载拿走的一切：面板打开时在 document 上监听，关闭后遗留的
// 监听器会作用于用户已经不再看的表面。
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

// 关闭监听的边界是一个属性，必须是启动器真正写下的那个：它标记为自己锚点的
// 外层容器。匹配一个页面里没人设置的属性，会让每次按启动器图标都被当成点击
// 面板外部，从而关掉刚刚打开的面板。
test('a press on the launcher does not close the panel it opened', async () => {
  const client = bootClient({ server })
  const press = (target) => client.react.act(() => {
    target.dispatchEvent(new client.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  })

  menuRow(launcher(client))[0].props.onClick()
  panel(client)
  await settle()

  // 页面上的其他地方才是这个监听器要处理的关闭操作。
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

// 插件级销毁是 shell 卸载整个 bundle：面板必须消失，样式表必须消失，启动器
// 认领也必须释放，之后加载的启动器装配才能取得互斥。
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

// 唯一关于文件本身而不是运行时的属性：启动器装配是 dock 片段，标记给
// `launcher:sync` 使用，不是手工维护的副本。`launcher:check` 比对字节；
// 这里说明它确实是那个片段。
test('the launcher assembly is the marked dock fragment', () => {
  assert.match(CLIENT_SRC, /\/\/ <dsh-utility-launcher>[\s\S]*\/\/ <\/dsh-utility-launcher>/)
  assert.equal(CLIENT_SRC.split('// <dsh-utility-launcher>').length - 1, 1)
  assert.equal(CLIENT_SRC.split('// </dsh-utility-launcher>').length - 1, 1)
})

// shell 加载的插件形状：定义的工厂返回带 `apply` 的对象，启动它就是注册上面
// 所有席位。断言在加载后的模块上，交回别的东西的 bundle 会在这里失败，而不是
// 靠正则匹配失败。
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
