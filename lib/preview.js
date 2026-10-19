// dsh-ballast 的内容预览。
//
// 一行消息的 token 数只说明它有多重；没有正文就无法判断这份重量是不是压舱物。
// 本模块把一个持久化会话事件转换成有长度上限的单行摘要。
//
// 三种 surface 事件的载荷形状不同：
//   - 'user/message'      data 就是 UserMessage         -> data.content
//   - 'assistant/message' data 包一层 message           -> data.message.content
//   - 'tool/result'       data 包一层 ToolResultMessage -> data.message.content[0]
//                                                          .content（再嵌一层）
// 统一读取 data.content 会让其中两类事件得到空预览，因此解包按事件类型进行，
// 测试也按类型覆盖。
//
// 预览与宿主的会话提取规则一致：推理块不进入预览，未知块类型按默认拒绝处理。
// ContentBlockMap 允许插件合并扩展，未知块是正常输入，不是错误。
//
// 这里每个函数都是全函数：格式错误或陌生的事件给出精简预览，绝不抛出——
// 预览不能让只读的 measure 路由失败。
//
// `chatIdentityOf` 是唯一的例外方向：它同样不抛出，但读不出来的身份保持
// `null`，因为聊天窗口按同一身份定位条目，读不出来就不给面板一个点了没有
// 反应的入口。

/** 限制载荷长度：预览只做摘要，不搬运整段日志。 */
export const PREVIEW_MAX_CHARS = 220

export const SURFACE_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])

/** 把连续空白折叠成一个空格，让预览保持在一行内。 */
function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

/** 按码点截断，避免把一个 emoji 或代理对切成两半。 */
function clip(text, limit) {
  const chars = Array.from(text)
  if (chars.length <= limit) return { text, chars: chars.length, truncated: false }
  return { text: chars.slice(0, limit).join(''), chars: chars.length, truncated: true }
}

/**
 * tool/result 只带 toolCallId，人类可读的工具名在配对的非 surface 事件
 * 'tool/call' 上，而该事件不会出现在 measure().nodes 里。给工具行加标签
 * 因此需要用日志建立 callId -> name 映射，每次计量遍历一遍日志。
 */
export function buildToolNameMap(events) {
  const names = new Map()
  if (!Array.isArray(events)) return names
  for (const event of events) {
    if (!event || event.type !== 'tool/call') continue
    const data = event.data
    if (!data || typeof data.callId !== 'string' || typeof data.name !== 'string') continue
    if (!names.has(data.callId)) names.set(data.callId, data.name)
  }
  return names
}

/**
 * 把内容块摊平成预览文本。递归处理，因为工具结果的内容块里还会再嵌内容块
 * （包括图片）。
 */
function walkBlocks(blocks, out, depth) {
  if (!Array.isArray(blocks) || depth > 4) return out
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string' && block.text !== '') out.text.push(oneLine(block.text))
        break
      case 'reasoning':
        // 推理内容不进入预览：它最难扫读，宿主的提取器同样丢弃。
        out.reasoning += 1
        break
      case 'image':
        out.images += 1
        break
      case 'tool-call':
        out.calls.push(typeof block.name === 'string' ? block.name : '(tool)')
        break
      case 'tool-result':
        if (block.isError === true) out.isError = true
        if (typeof block.toolCallId === 'string') out.toolCallIds.push(block.toolCallId)
        walkBlocks(block.content, out, depth + 1)
        break
      default:
        // 未知块类型（该映射允许插件合并扩展）：只计数，不猜测其结构。
        out.other += 1
    }
  }
  return out
}

function emptyWalk() {
  return { text: [], reasoning: 0, images: 0, calls: [], toolCallIds: [], isError: false, other: 0 }
}

/** `source.kind` 区分人类输入与插件注入的上下文。 */
function isInjected(message) {
  const source = message && message.source
  return !!source && typeof source.kind === 'string' && source.kind !== 'user'
}

/**
 * 把三种 surface 载荷解包成 content 持有内容块的 Message；其他形状返回 null。
 */
function messageOf(event) {
  const data = event.data
  if (!data || typeof data !== 'object') return null
  switch (event.type) {
    case 'user/message':
      return data
    case 'assistant/message':
    case 'tool/result':
      return data.message && typeof data.message === 'object' ? data.message : null
    default:
      return null
  }
}

/**
 * 'append' 把节点追加到末尾；{ op:'replace', start, end } 是压缩写入，替换了
 * 一段 surface 区间。这里只报告种类：区间指的是 surface 位置，不是事件 seq。
 */
export function surfaceOpKind(event) {
  const op = event && event.surfaceOp
  if (op === 'append') return 'append'
  if (op && typeof op === 'object' && op.op === 'replace') return 'replace'
  return null
}

/**
 * 为一个持久化事件生成有长度上限的预览。非 surface 事件返回 null，面板据此
 * 区分“没有正文”和“不是 surface 行”。`chars` 是截断前规范化预览串的长度
 * （空白已折叠，`[tool]` / `→ calls` 标签已前置），不是原始消息长度。
 */
export function extractPreview(event, toolNames) {
  if (!event || typeof event.type !== 'string') return null
  if (!SURFACE_EVENT_TYPES.has(event.type)) return null
  const message = messageOf(event)
  if (!message || !Array.isArray(message.content)) {
    return { kind: event.type, text: '', chars: 0, truncated: false, blocks: 0, shape: 'unknown' }
  }
  const walk = walkBlocks(message.content, emptyWalk(), 0)
  const parts = []
  if (event.type === 'tool/result') {
    // 真正的载荷在嵌套的 tool-result 块里，用工具名给它加标签。
    const callId = walk.toolCallIds[0]
    const name = (callId && toolNames && toolNames.get(callId)) || null
    if (name) parts.push(`[${name}]`)
    else parts.push('[tool]')
  }
  if (walk.text.length) parts.push(walk.text.join(' '))
  if (walk.calls.length) parts.push(`→ ${walk.calls.join(', ')}`)
  const joined = oneLine(parts.join(' '))
  const clipped = clip(joined, PREVIEW_MAX_CHARS)
  const preview = {
    kind: event.type,
    text: clipped.text,
    chars: clipped.chars,
    truncated: clipped.truncated,
    blocks: message.content.length
  }
  if (walk.images) preview.images = walk.images
  if (walk.reasoning) preview.reasoning = walk.reasoning
  if (walk.other) preview.other = walk.other
  if (walk.isError) preview.isError = true
  if (event.type === 'tool/result' && message.content[0] && Array.isArray(message.content[0].content)) {
    preview.blocks = message.content[0].content.length
  }
  if (event.data && event.data.interrupted === true) preview.interrupted = true
  if (event.type === 'user/message' && isInjected(message)) preview.injected = true
  return preview
}

// ---- 聊天条目身份 -------------------------------------------------------
// 面板要滚动定位的那一条，靠的是聊天窗口自己写在 DOM 上的属性。这些属性是
// 宿主内部约定，不是公开 API，所以身份在宿主侧算出来，面板只拿到一组值：宿主
// 换掉命名规则时，这里读到 null，面板不给入口，而不是给一个点了没反应的按钮。

/**
 * 聊天窗口的节点 key：一个业务定义 kind 与它自己的业务身份 id。key 的格式
 * 由宿主的 `conversationContextKey` 决定，这里按同样的规则拼：kind 的长度
 * 前缀让 `1:a2:bc` 与 `2:ab2:bc` 不会互相撞上。
 */
function chatNodeKey(kind, id) {
  return `${kind.length}:${kind}${id}`
}

/**
 * 一个 surface 事件在聊天窗口里的定位身份。
 *
 * 三种 surface 事件各由一个业务定义渲染，所以身份取自那个定义的 match：
 *   - `user/message`  → kind `input-message`，id 是消息 id
 *   - `assistant/message` → kind `assistant-step`，id 是 `turn:step`
 *   - `tool/result`   → kind `tool-call`，id 是 `source.callId`
 * turn 单独给出，因为同一个 turn 里的候选不止一个：拿不到精确身份时，面板
 * 至少能定位到这个 turn。
 *
 * 任何字段读不出来就整体返回 null——半个身份会让定位落在一个错误的条目上，
 * 那比没有入口更糟。
 */
export function chatIdentityOf(event) {
  if (!event || typeof event.type !== 'string') return null
  const data = event.data
  if (data === null || typeof data !== 'object') return null
  switch (event.type) {
    case 'user/message': {
      const id = data.id
      if (typeof id !== 'string' || id === '') return null
      return { nodeKey: chatNodeKey('input-message', id), turn: null }
    }
    case 'assistant/message': {
      if (!Number.isInteger(data.turn) || !Number.isInteger(data.step)) return null
      return { nodeKey: chatNodeKey('assistant-step', `${data.turn}:${data.step}`), turn: data.turn }
    }
    case 'tool/result': {
      const callId = data.message && data.message.source && data.message.source.callId
      if (typeof callId !== 'string' || callId === '') return null
      return {
        nodeKey: chatNodeKey('tool-call', callId),
        turn: Number.isInteger(data.turn) ? data.turn : null
      }
    }
    default:
      return null
  }
}
