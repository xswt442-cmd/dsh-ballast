// 浏览器端的真实运行时，由客户端测试文件共用。
//
// `lib/client.js` 是经典脚本，把定义交给 `window.__ModuleLoader__`，所以诚实
// 的测试方式是求值它并渲染它注册的内容：对源码做文本断言时，标识符只出现在
// 注释里也会通过；渲染出的树只有在组件真正工作时才通过。本模块在 vm 中用
// 真实 DOM（happy-dom）、宿主发布的真实 `react` 包和真实 `react-dom/client`
// 渲染器启动 bundle；插件注册的每个席位都挂载到自己的 React 根上，并通过
// `React.act` 重新渲染，因此 hook 状态、effect 顺序与协调都是框架自己的行为，
// 不是替代品。
//
// 沙箱不提供 `require`、`module`、`exports`、`process` 或 ESM 加载器，所以
// 访问 Node 内置模块或写 `import` 的客户端代码会在这里启动失败，而不是
// 通过一次文本匹配。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

import React from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'

const act = React.act

// `react-dom` 在渲染期间从全局读取 `window` / `document`（事件委托目标、
// 活动元素查找）。每次 `bootClient` 在首次渲染前把它们指向自己的 happy-dom
// `Window`，所以整个测试文件——一次启动一个客户端——针对该客户端的 DOM 解析
// 这些查找，而 vm 保持自己对同一批对象的隔离引用。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const CLIENT_SOURCE = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

/** 本插件贡献一行的启动器菜单席位（dock 片段）。 */
export const UTILITY_ITEM_SLOT = 'createhelper.utility.item'
/** shell 层席位：启动器本身与本插件的面板。 */
export const OVERLAY_SLOT = 'shell.overlay'
/** Sidebar Session 行悬停卡片席位。 */
export const HOVER_SLOT = 'sidebar.session.row.hover'

// --- 树辅助函数 -----------------------------------------------------------

export function allNodes(node, predicate, out = []) {
  if (!node) return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) allNodes(child, predicate, out)
  return out
}

export function textOf(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  return (node.text || '') + (node.children || []).map(textOf).join('')
}

export function byClass(className) {
  return (node) => node.props && node.props.className === className
}

/** 渲染树中的按钮，按文档顺序。 */
export const buttonsIn = (node) => allNodes(node, (item) => item.type === 'button')

/** 等待渲染与 fetch 链稳定：冲刷 React 工作并推进宏任务。 */
export const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

// --- 从真实 DOM 生成快照 ------------------------------------------------

// React 拥有 DOM。测试面对的树是这份 DOM 的只读快照：每个元素节点变成
// `{type, props, children}` 记录，每个文本节点变成 `{type:'text', text}`
// 记录。`props` 对应 React 写入的内容：HTML 属性保留原名（`aria-pressed`、
// `title`、`data-*` 等），布尔 `hidden` 属性以 `props.hidden` 出现，`class`
// 以 `props.className` 出现；每个元素暴露的 `props.onClick()` 会在 `act` 内
// 把真实的冒泡 `click` 事件重新交给 React 的事件系统。测试文件的断言因此读取
// 同一种形状，而每次交互都走 React 自己的事件与调度路径。

const ELEMENT_NODE = 1
const TEXT_NODE = 3

function snapshotElement(element, win) {
  const props = { onClick: () => clickIn(element, win) }
  for (const attribute of element.attributes) props[attribute.name] = attribute.value
  // React 通过 DOM 属性而不是 HTML 属性写入这两个值：`hidden` 是布尔值
  // （只看属性永远读回 ""），`class` 以 `className` 到达测试。两者都优先于
  // 原始属性。
  props.hidden = element.hidden === true
  if (element.className) props.className = element.className
  const children = []
  for (const child of element.childNodes) {
    const snap = snapshotNode(child, win)
    if (snap) children.push(snap)
  }
  return { type: String(element.tagName).toLowerCase(), props, children }
}

function snapshotNode(node, win) {
  if (node.nodeType === TEXT_NODE) return { type: 'text', props: {}, children: [], text: node.nodeValue }
  if (node.nodeType !== ELEMENT_NODE) return null
  return snapshotElement(node, win)
}

function clickIn(element, win) {
  act(() => { element.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) })
}

function snapshotContainer(container, win) {
  const roots = []
  for (const child of container.childNodes) {
    const snap = snapshotNode(child, win)
    if (snap) roots.push(snap)
  }
  if (roots.length === 0) return null
  if (roots.length === 1) return roots[0]
  return { type: 'fragment', props: {}, children: roots }
}

// --- 每次启动的 document 观察器 ------------------------------------------

// 客户端直接在 document 上挂关闭与按键监听；测试需要观察它们在卸载时被
// 移除。观察器包装真实 happy-dom document 的 `addEventListener` /
// `removeEventListener`，所以记录到的就是 React 自己看到的内容（传给 add 与
// remove 的处理函数引用一致），并暴露 `hasStyle(id)` 供插件样式表检查使用。
function makeDocumentObserver(doc) {
  const listeners = []
  const realAdd = doc.addEventListener.bind(doc)
  const realRemove = doc.removeEventListener.bind(doc)
  doc.addEventListener = (type, handler, options) => {
    listeners.push({ type, handler })
    return realAdd(type, handler, options)
  }
  doc.removeEventListener = (type, handler, options) => {
    const at = listeners.findIndex((item) => item.type === type && item.handler === handler)
    if (at !== -1) listeners.splice(at, 1)
    return realRemove(type, handler, options)
  }
  doc.hasStyle = (id) => doc.querySelector(`style[data-plugin-css="${id}"]`) !== null
  doc.listeners = listeners
  return doc
}

// --- 根注册表 ------------------------------------------------------------

// 一个席位实例按同一身份只 `createRoot` 挂载一次，之后每次调用重新渲染——
// 这就是 shell 对每个槽位保持一个已挂载组件的方式。身份是组件引用加上 props
// 的结构指纹：不带数据的席位（启动器、面板、菜单行）每次调用指纹相同，因此
// 复用同一个根与 hook 状态；shell 会在不同数据上下文中复用的席位（Session
// 行悬停卡片每行一个实例）按数据标识，每个上下文挂载新的根。渲染两个悬停
// 卡片的测试因此面对两个活着的组件，而点击并重新渲染面板的测试仍然面对
// 同一个。
function makeRootRegistry(win) {
  const byKey = new Map()
  const typeIds = new Map()
  let nextTypeId = 0
  const typeIdOf = (type) => {
    if (typeIds.has(type)) return typeIds.get(type)
    const id = nextTypeId++
    typeIds.set(type, id)
    return id
  }
  // props 里的函数引用就是 shell 自己的槽位渲染交给启动器的内容：该引用在
  // 这个席位的每次渲染中保持稳定，所以把两次渲染联系起来的函数是它的身份
  // （不是它的源码）。
  let nextFnId = 0
  const fnIds = new Map()
  const fnIdOf = (fn) => {
    if (fnIds.has(fn)) return fnIds.get(fn)
    const id = nextFnId++
    fnIds.set(fn, id)
    return id
  }
  const fingerprint = (value, depth = 0) => {
    if (depth > 4) return '?'
    if (value === null || value === undefined) return String(value)
    const kind = typeof value
    if (kind === 'function') return `f${fnIdOf(value)}`
    if (kind !== 'object') return `${kind}:${String(value)}`
    if (Array.isArray(value)) return `[${value.map((item) => fingerprint(item, depth + 1)).join(',')}]`
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${k}=${fingerprint(value[k], depth + 1)}`).join(',')}}`
  }

  const keyFor = (element) => `${typeIdOf(element.type)}|${fingerprint(element.props || {})}`

  const mount = (element) => {
    const key = keyFor(element)
    let entry = byKey.get(key)
    if (!entry) {
      const container = win.document.createElement('div')
      win.document.body.appendChild(container)
      entry = { container, root: createRoot(container) }
      byKey.set(key, entry)
    }
    act(() => { entry.root.render(element) })
    return snapshotContainer(entry.container, win)
  }

  return { mount }
}

// --- 启动 ----------------------------------------------------------------

/**
 * 求值客户端 bundle 并应用它注册的插件。
 * @param server - `(url) => body`，面板读取的宿主。
 */
export function bootClient({ server = () => ({ ok: false }) } = {}) {
  const win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  const doc = makeDocumentObserver(win.document)
  const registered = []
  const fetched = []
  const context = {
    console: { warn() {}, error() {} },
    navigator: { language: 'en-US' },
    document: doc,
    window: win,
    fetch: async (url) => {
      fetched.push(String(url))
      return { ok: true, status: 200, json: async () => server(String(url)) }
    }
  }

  let definition = null
  win.__ModuleLoader__ = { load(value) { definition = value } }
  vm.runInNewContext(CLIENT_SOURCE, context, { filename: 'lib/client.js' })
  assert.ok(definition, 'the bundle never registered itself with window.__ModuleLoader__')

  const plugin = definition.factory((name) => {
    assert.equal(name, 'react', 'the bundle must take React from the platform seed')
    return React
  })

  const registry = makeRootRegistry(win)
  const slots = {
    // 伪造的 shell 立即解析每个席位：这些测试关心的是席位渲染什么，不是
    // 提供它的运行时顺序。
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
  // 席位按框架的方式渲染——作为元素，绝不裸调用组件——所以它的 hook 槽位
  // 属于它自己。
  const renderSeat = (name, id, props = {}) => {
    const seat = entry(name, id)
    assert.ok(seat, `no seat registered for ${name} / ${id}`)
    return registry.mount(React.createElement(seat.render, props))
  }
  // shell 自己的槽位渲染器，启动器按名字向它索取。已注册项组合在调用方的
  // 根下，按槽位 id 作 key——与 shell 挂载槽位树时给子节点作 key 的方式相同。
  const renderSlot = (name) => React.createElement(React.Fragment, null,
    registered.filter((item) => item.options.name === name)
      .map((item) => React.createElement(item.render, { key: item.options.id })))
  // 通过框架渲染任意 React 元素。直接取席位渲染回调的测试文件使用它。
  const renderNode = (element) => registry.mount(element)

  return {
    react: React,
    renderNode,
    definition,
    plugin,
    registered,
    fetched,
    entry,
    renderSeat,
    renderSlot,
    sandbox: context,
    window: win,
    document: doc,
    // 插件卸载时 shell 会执行的全部内容。销毁会释放状态（面板自行关闭），
    // 所以它的 React 工作与其他交互一样通过 `act` 冲刷。
    dispose: async () => {
      for (const handler of disposers.splice(0)) {
        await act(async () => { await handler() })
      }
    }
  }
}
