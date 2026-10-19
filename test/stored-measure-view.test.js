// 已存储会话那一半的按需计量。
//
// 列出一行与计量一行成本差一个量级：计量要把该会话的完整事件日志从盘上读进
// 内存。所以这个文件固定的是「什么时候读」「读到的东西放在哪里」以及「失败
// 落在哪一行」——存储列表本身仍然是廉价的目录读取。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OVERLAY_SLOT, UTILITY_ITEM_SLOT, allNodes, bootClient, buttonsIn, byClass, settle, textOf
} from './support/client-runtime.js'

// ---- 宿主 ----------------------------------------------------------------

function storedHost({ coldSessions, coldMeasure, measurable } = {}) {
  return (url) => {
    if (url.includes('action=sessions')) {
      return { ok: true, availability: 'available', sessions: [] }
    }
    if (url.includes('action=top')) return { ok: true, limit: 5, sessions: [], failedCount: 0, failures: [] }
    if (url.includes('action=cold-measure')) {
      return coldMeasure
        ? coldMeasure(url)
        : {
          ok: true,
          sessions: [{ sessionId: 'old-1', measurement: { surfaceTokens: 4321, nodeCount: 7 } }],
          failedCount: 0,
          failures: []
        }
    }
    if (url.includes('action=cold')) {
      return {
        ok: true,
        storedAvailability: 'available',
        measureAvailability: measurable === false ? 'unavailable' : 'available',
        sessions: coldSessions || [
          { sessionId: 'old-1', title: 'Alpha', sizeBytes: 4096, eventCount: 30, revision: 30, projections: null },
          { sessionId: 'old-2', title: 'Beta', sizeBytes: 2048, eventCount: 12, revision: 12, projections: null }
        ]
      }
    }
    return { ok: false, code: 'bad_action' }
  }
}

/** 打开面板、切到跨会话视图、等它的两次读取落地。 */
async function openHostView(client) {
  const menu = client.renderNode(client.entry(UTILITY_ITEM_SLOT, 'ballast').render({}))
  buttonsIn(menu)[0].props.onClick()
  const panel = client.entry(OVERLAY_SLOT, 'ballast-panel')
  client.renderNode(panel.render())
  await settle()
  // 启动器菜单里的「跨会话」按钮：它触发存储列表与活跃扫描这两次读取。
  const hostView = allNodes(client.renderNode(panel.render()), (node) => node.type === 'button' && node.props['aria-pressed'] === 'false')
    .find((node) => node.props.title === 'Find the heaviest entries across live sessions on this host')
  assert.ok(hostView, 'the cross-session toggle is missing from the panel')
  hostView.props.onClick()
  client.renderNode(panel.render())
  await settle()
  return () => client.renderNode(panel.render())
}

const measureButtons = (tree) => allNodes(tree, byClass('dshbl-measure'))
const storedRows = (tree) => allNodes(tree, (node) => node.props.className === 'dshbl-hostrow dshbl-static')

// ---- 入口 ----------------------------------------------------------------

test('the stored list offers a measure action per row', async () => {
  const client = bootClient({ server: storedHost() })
  const panel = await openHostView(client)
  assert.equal(measureButtons(panel()).length, 2, 'each stored row offers one measure action')
})

test('the measure action says it reads from disk', async () => {
  const client = bootClient({ server: storedHost() })
  const panel = await openHostView(client)
  // 读盘是这一次点击的真实成本，所以按钮自己说明它，而不是让用户猜。
  const [first] = measureButtons(panel())
  assert.match(first.props.title, /reads from disk/)
  assert.equal(textOf(first), 'Measure')
  assert.equal(first.props.type, 'button', 'the action must be reachable by keyboard')
})

test('listing stored sessions reads nothing beyond the directory', async () => {
  const client = bootClient({ server: storedHost() })
  await openHostView(client)
  // 存储列表与活跃扫描都不读日志：计量是点击之后才发生的读盘。
  assert.equal(client.fetched.filter((url) => url.includes('action=cold-measure')).length, 0)
})

// ---- 点击计量 ------------------------------------------------------------

test('clicking measure reads that one session and shows its surface total', async () => {
  const client = bootClient({ server: storedHost() })
  const panel = await openHostView(client)
  measureButtons(panel())[0].props.onClick()
  await settle()

  const reads = client.fetched.filter((url) => url.includes('action=cold-measure'))
  assert.equal(reads.length, 1, 'one click reads one session')
  assert.match(reads[0], /sessionIds=old-1/, 'the clicked row is the one measured')
  const tree = panel()
  assert.match(textOf(tree), /surface 4,321 · 7 items/)
})

test('a measured row drops its action, so a session is never read twice', async () => {
  const client = bootClient({ server: storedHost() })
  const panel = await openHostView(client)
  measureButtons(panel())[0].props.onClick()
  await settle()

  const tree = panel()
  // 第一行已经有真实数字，再给一个入口就是让用户可以重复付这份读盘成本。
  assert.equal(measureButtons(tree).length, 1)
  assert.match(textOf(storedRows(tree)[0]), /surface 4,321/)
})

test('each row is measured on its own click', async () => {
  const client = bootClient({ server: storedHost() })
  const panel = await openHostView(client)
  measureButtons(panel())[1].props.onClick()
  await settle()

  const reads = client.fetched.filter((url) => url.includes('action=cold-measure'))
  assert.equal(reads.length, 1)
  assert.match(reads[0], /sessionIds=old-2/)
})

// ---- 失败落在哪一行 ------------------------------------------------------

test('a failed measurement is reported on that row, not on the list', async () => {
  const client = bootClient({
    server: storedHost({
      coldMeasure: () => ({
        ok: true,
        sessions: [],
        failedCount: 1,
        failures: [{ sessionId: 'old-1', error: 'seed event at index 0 has seq 9 (expected 0)' }]
      })
    })
  })
  const panel = await openHostView(client)
  measureButtons(panel())[0].props.onClick()
  await settle()

  const tree = panel()
  // 损坏的日志是那一行自己的事：它失败，列表其余部分照常。
  assert.match(textOf(storedRows(tree)[0]), /measurement failed/)
  assert.equal(storedRows(tree).length, 2, 'the rest of the list survives a failed row')
  assert.equal(measureButtons(tree).length, 1, 'the other row is still measurable')
  // 提示里给出宿主抛出的原因，而标题只是标签。
  const failed = allNodes(tree, (node) => node.props.className === 'dshbl-meta dshbl-spread')[0]
  assert.match(failed.props.title, /seed event/)
})

test('a host that cannot measure drops the action instead of failing repeatedly', async () => {
  // 503 是「此宿主不提供该能力」，不是一次可以重试的失败：反复点一个不会消失
  // 的按钮没有意义。
  const client = bootClient({
    server: storedHost({ coldMeasure: () => ({ ok: false, code: 'unavailable' }) })
  })
  const panel = await openHostView(client)
  measureButtons(panel())[0].props.onClick()
  await settle()

  const tree = panel()
  assert.equal(measureButtons(tree).length, 0, 'an unavailable capability withdraws the entry')
  assert.equal(storedRows(tree).length, 2, 'the stored list itself is unaffected')
})

test('a rejected measure request puts the failure on screen', async () => {
  const client = bootClient({ server: storedHost() })
  const panel = await openHostView(client)
  // 让这一次请求拒绝：DSH 重启或 HMR 断开 socket 时 fetch() 会拒绝。
  const realFetch = client.sandbox.fetch
  client.sandbox.fetch = async (url) => {
    if (String(url).includes('action=cold-measure')) throw new Error('socket closed')
    return realFetch(url)
  }
  measureButtons(panel())[0].props.onClick()
  await settle()

  const tree = panel()
  assert.match(textOf(allNodes(tree, byClass('dshbl-error'))[0]), /cold-measure request failed/)
  assert.equal(measureButtons(tree).length, 2, 'a failed read leaves the actions retryable')
})

// ---- 会话停用后重新计量 --------------------------------------------------

test('leaving the cross-session view drops the measured readings', async () => {
  const client = bootClient({ server: storedHost() })
  const panel = await openHostView(client)
  measureButtons(panel())[0].props.onClick()
  await settle()
  assert.match(textOf(panel()), /surface 4,321/)

  // 回到单会话视图再切回来：这些数字描述的是上一次读取，不该被当成此刻的读数
  // 留在屏幕上。
  const single = allNodes(panel(), (node) => node.type === 'button' && node.props['aria-pressed'] === 'true')[0]
  single.props.onClick()
  await settle()
  const back = await openHostView(client)
  assert.doesNotMatch(textOf(back()), /surface 4,321/)
})