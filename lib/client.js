// dsh-ballast 浏览器端。经典脚本客户端模块，DSH 客户端模块的标准形式：
// 向 window.__ModuleLoader__ 注册工厂；React 来自平台种子，数据来自同源的
// JSON 端点 /dsh-ballast/api（宿主端）。
//
// DSH 按字节原样提供这个文件：serve 时不运行打包器，传输方式是经典
// <script>，所以 `import` 会直接成为语法错误。dock 的启动器因此嵌入在下方，
// 而不是通过 import 引入；它由 `npm run launcher:sync` 从
// dsh-mini-utility-dock 生成，修改应落在该包，不要编辑这段代码
// （`npm run launcher:check` 会因内容漂移而失败）。该片段注册页面上唯一的
// 启动器图标及其菜单，并把本插件的一行加入菜单，因此 ballast 可以独立安装，
// 不需要其他插件提供入口。

window.__ModuleLoader__.load({
  id: 'dsh-ballast',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement


    // ---- 插件样式 --------------------------------------------------------
    const CSS_ID = 'dsh-ballast'
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') !== null) return
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin-css', CSS_ID)
      styleEl.textContent =
        '.dshbl-layer{position:fixed;top:64px;right:16px;width:440px;max-width:calc(100vw - 32px);max-height:min(460px,62vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:9999;pointer-events:auto;font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden}' +
        '.dshbl-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}' +
        '.dshbl-title{margin:0;font-size:14px;font-weight:600}' +
        '.dshbl-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
        // 哪个宿主进程作答是快照的一部分事实，所以放在副标题已经占用的
        // 头部行上；语言需要空间时头部换行，而不是压缩控件。
        '.dshbl-hostproc{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}' +
        '.dshbl-spacer{flex:1}' +
        '.dshbl-count{font-size:11px;line-height:17px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}' +
        '.dshbtn{display:flex;align-items:center;gap:6px;padding:6px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;cursor:pointer;font:inherit;white-space:nowrap}' +
        '.dshbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}' +
        '.dshbl-body{overflow:auto;padding:6px 8px}' +
        '.dshbl-controls{display:flex;align-items:center;gap:6px;padding:2px 6px 8px}' +
        '.dshbl-select{flex:1;min-width:0;font:inherit;font-size:12px;padding:4px 6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit}' +
        '.dshbl-totals{display:flex;flex-wrap:wrap;gap:10px;padding:0 10px 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-total-strong{color:var(--dsw-alias-label-primary);font-weight:600}' +
        '.dshbl-projections{margin:0 10px 8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);display:grid;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-projection-line{display:flex;flex-wrap:wrap;gap:8px}' +
        // 说明区是条目列表上方的参考内容，因此使用面板主体自己的水平内边距
        // （不再缩进一层），只占用它需要的垂直空间：摘要是一行条带，不是
        // 一块区域。
        '.dshbl-details{margin:0 0 4px}' +
        '.dshbl-details-summary{display:flex;align-items:baseline;gap:8px;padding:2px 6px;border-radius:7px;cursor:pointer;font-size:11px;line-height:1.35;color:var(--dsw-alias-label-secondary);list-style:none}' +
        '.dshbl-details-summary::-webkit-details-marker{display:none}' +
        '.dshbl-details-summary:before{content:"▸";font-size:9px}' +
        '.dshbl-details[open]>.dshbl-details-summary:before{content:"▾"}' +
        '.dshbl-details-summary:hover{background:var(--dsw-alias-bg-layer-2)}' +
        '.dshbl-sum-item{color:var(--dsw-alias-label-primary);font-weight:600}' +
        // 展开后的明细沿用摘要不再需要的缩进，让正文读起来是一列，折叠状态
        // 保持紧凑。缩进对所有嵌套块使用同一个值，任何块都不会偏离这一列。
        '.dshbl-details .dshbl-totals{margin-top:4px;padding-left:6px;padding-right:6px}' +
        '.dshbl-details .dshbl-projections{margin-top:4px;padding-left:6px;padding-right:6px}' +
        '.dshbl-details .dshbl-share{margin:6px 6px 5px}' +
        '.dshbl-details .dshbl-legend{margin:0 6px 6px;padding-left:0;padding-right:0}' +
        '.dshbl-share{display:flex;height:9px;margin:0 10px 5px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}' +
        '.dshbl-share-seg{height:100%;min-width:2px;background:var(--dsw-alias-brand-primary)}' +
        '.dshbl-legend{display:flex;flex-wrap:wrap;gap:10px;padding:0 10px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-hostrow{position:relative;display:flex;align-items:baseline;gap:8px;padding:6px 10px;border-radius:9px;cursor:pointer}' +
        '.dshbl-hostrow:hover{background:var(--dsw-alias-bg-layer-2)}' +
        // 已存储会话没有可打开的活跃 Agent，所以它的行是读数，不是控件：
        // 不能继承活跃行的指针交互提示。
        '.dshbl-static{cursor:default}' +
        '.dshbl-static:hover{background:transparent}' +
        '.dshbl-section{margin:10px 10px 4px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;align-items:baseline;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-error{margin:0 10px 8px;padding:8px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:12px;white-space:pre-wrap}' +
        '.dshbl-row{position:relative;display:flex;align-items:baseline;gap:8px;padding:5px 10px;border-radius:9px;overflow:hidden}' +
        '.dshbl-row:hover{background:var(--dsw-alias-bg-layer-2)}' +
        '.dshbl-bar{position:absolute;left:0;top:0;bottom:0;opacity:.14;background:currentColor;pointer-events:none}' +
        '.dshbl-seq{position:relative;min-width:38px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}' +
        '.dshbl-type{position:relative;min-width:46px;font-size:11px;color:var(--dsw-alias-brand-primary)}' +
        '.dshbl-text{position:relative;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.dshbl-tokens{position:relative;font-variant-numeric:tabular-nums;font-weight:600}' +
        '.dshbl-meta{position:relative;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}' +
        '.dshbl-spread{color:var(--dsw-alias-state-warn-primary)}' +
        '.dshbl-tag{font-size:10.5px;line-height:15px;padding:0 5px;border-radius:999px;border:1px solid currentColor;color:var(--dsw-alias-label-secondary)}' +
        '.dshbl-tag-warn{color:var(--dsw-alias-state-warn-primary)}' +
        // 定位按钮贴在行尾，不占行的弹性宽度：正文才是这一行要读的东西。
        // 平时透明，悬停或聚焦时才显形，所以一屏条目仍然只是条目。
        '.dshbl-locate{flex:none;align-self:center;padding:1px 6px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;opacity:0}' +
        '.dshbl-row:hover .dshbl-locate,.dshbl-locate:focus-visible{opacity:1}' +
        '.dshbl-locate:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l1)}' +
        '.dshbl-locate:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}' +
        // 高亮是浮在聊天窗口之上的一层，不是给宿主的节点加类：那些节点由宿主
        // 拥有，插件改它们的属性会在下一次 React 渲染里被抹掉。
        '.dshbl-chatflash{position:fixed;pointer-events:none;z-index:9998;background:var(--dsw-alias-brand-primary);opacity:.28;transition:opacity .7s ease-out}' +
        '.dshbl-foot{padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;flex:none}' +
        '.dshbl-empty{padding:14px 10px;color:var(--dsw-alias-label-secondary)}' +
        // Session 行悬停区是行卡片自己的一行内容，因此沿用卡片的字号层级，
        // 不套用面板的盒状外观。
        '.dshbl-hover{display:flex;align-items:baseline;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}' +
        '.dshbl-hover-fact{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.dshbl-hover-open{flex:none;margin-left:auto;padding:2px 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}' +
        '.dshbl-hover-open:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}'
      document.head.appendChild(styleEl)
    }

    // ---- 打开状态 --------------------------------------------------------
    const BALLAST_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M6 12h12M9 19h6"></path></svg>'

    const openStore = { open: false, listeners: new Set() }
    const localeStore = { listeners: new Set() }
    const setOpen = (value) => {
      openStore.open = !!value
      openStore.listeners.forEach((listener) => listener())
    }
    const useOpen = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1)
        openStore.listeners.add(listener)
        return () => openStore.listeners.delete(listener)
      }, [])
      return openStore.open
    }

    const useLocaleRevision = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1)
        localeStore.listeners.add(listener)
        return () => localeStore.listeners.delete(listener)
      }, [])
    }

    // ---- 会话定位 --------------------------------------------------------
    // Session 行悬停区够不到面板自己的 selectSession 闭包，所以请求经由模块
    // 状态传递：悬停区记下会话并打开面板，面板下一次读取消费这条记录，转向
    // 该会话。跨模块传递的只有 id，这里不触网，所以悬停本身永远不是一次
    // 宿主请求。
    const focusStore = { sessionId: null, pending: false, revision: 0, listeners: new Set() }
    const requestSessionFocus = (sessionId) => {
      if (typeof sessionId !== 'string' || sessionId === '') return
      focusStore.sessionId = sessionId
      focusStore.pending = true
      focusStore.revision += 1
      focusStore.listeners.forEach((listener) => listener())
      setOpen(true)
    }
    const useFocusRevision = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1)
        focusStore.listeners.add(listener)
        return () => focusStore.listeners.delete(listener)
      }, [])
      return focusStore.revision
    }
    // 由请求触发的那次读取在开头消费，让会话列表与随后的计量保持同一个
    // 意图。
    const consumeFocus = () => {
      if (!focusStore.pending) return null
      focusStore.pending = false
      return focusStore.sessionId
    }

    // ---- 会话事实 --------------------------------------------------------
    // 宿主已经告知本插件的逐会话事实，按宿主使用的 sessionId 存放。每个字段
    // 都来自用户自己的读取所返回的载荷——这里从不计量或估算——所以下方的
    // 悬停区可以从内存作答，不必为指针经过的每一行支付一次新的 `measure`。
    // 只被列出的会话带着标题和日志长度，没有任何 token 数字；这种缺席保持
    // 为缺席，不默认成 0。
    const sessionFacts = new Map()
    const factsStore = { revision: 0, listeners: new Set() }
    const readSessionFacts = (sessionId) => sessionFacts.get(sessionId) || null

    const rememberSessionFacts = (sessionId, patch) => {
      if (typeof sessionId !== 'string' || sessionId === '') return
      const before = sessionFacts.get(sessionId)
      const next = { ...(before || {}) }
      const put = (key, value) => {
        if (value !== undefined && value !== null) next[key] = value
      }
      put('title', typeof patch.title === 'string' && patch.title !== '' ? patch.title : undefined)
      put('titleSource', typeof patch.titleSource === 'string' ? patch.titleSource : undefined)
      put('eventCount', finite(patch.eventCount))
      put('totalTokens', finite(patch.totalTokens))
      put('surfaceTokens', finite(patch.surfaceTokens))
      put('nodeCount', finite(patch.nodeCount))
      // 只有有限的 token 数字才构成“最重”条目：宿主没有定价的行不是最重的
      // *有价* 条目，不能缓存成一个数字再被当作数字交回去。
      const heaviest = patch.heaviest && typeof patch.heaviest === 'object' ? patch.heaviest : null
      if (heaviest && finite(heaviest.tokens) !== undefined) {
        put('heaviest', {
          seq: finite(heaviest.seq),
          type: typeof heaviest.type === 'string' ? heaviest.type : null,
          tokens: finite(heaviest.tokens)
        })
      }
      if (JSON.stringify(next) === JSON.stringify(before)) return
      sessionFacts.set(sessionId, next)
      factsStore.revision += 1
      factsStore.listeners.forEach((listener) => listener())
    }

    const useFactsRevision = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1)
        factsStore.listeners.add(listener)
        return () => factsStore.listeners.delete(listener)
      }, [])
      return factsStore.revision
    }

    // ---- 视图辅助函数 ----------------------------------------------------
    const LOCALE_NS = 'dsh-ballast'
    const ZH = {
      'dock.label': '窗口压舱物',
      'subtitle': '窗口被谁占了',
      'type.user': '用户', 'type.assistant': '助手', 'type.tool': '工具',
      'row.noBody': '(无正文)', 'row.missingEvent': '(事件缺失)',
      'row.unknownBody': '(未识别正文)', 'row.images': '{count} 张图片',
      'row.reasoningOnly': '仅推理内容', 'row.unknownBlocks': '{count} 个未知块',
      'row.emptyResult': '空结果', 'row.empty': '(空)',
      'row.truncated': '{summary}（已截断，原文 {count} 字符）',
      'shadow.absent': '无影子价',
      'shadow.absentTitle': '此 DSH 宿主不提供 heuristic 影子价，无价差可比',
      'shadow.partial': '影子价不全',
      'shadow.partialTitle': '部分条目没有 heuristic 影子价，这些条目无价差可比',
      'unit.items': '{count} 条', 'unit.events': '{count} 条', 'unit.logEvents': '日志 {revision} / {count} 条',
      'unpriced.label': '{count} 条价格不可读',
      'unpriced.title': '宿主给出的节点价格不是数字。这些行画破折号，不参与合计与占比，也不代表 0。',
      'age.seconds': '{count} 秒前', 'age.minutes': '{count} 分钟前', 'age.hours': '{count} 小时前',
      'error.measure': 'measure 请求失败：{error}', 'error.top': 'top 请求失败：{error}',
      'availability.ready': '计量就绪', 'availability.unavailable': 'tokenMeter 未就绪', 'availability.checking': '检测中',
      'sessions.count': '本宿主进程 {count} 个会话', 'sessions.scanning': '扫描中…',
      'refresh.title': '重新计量当前视图', 'refresh.loading': '刷新中', 'refresh.action': '刷新', 'close': '关闭',
      'sessions.loading': '加载中…', 'sessions.none': '无活跃会话',
      'host.title': '跨会话看这台机器上最重的条目（会逐个活跃会话计量）',
      'host.single': '看单会话', 'host.all': '跨会话', 'host.live': '{count} 个活跃会话',
      'host.limit': '每会话最多 {count} 条', 'host.failed': '{count} 个会话计量失败',
      'host.empty': '没有可计量的活跃会话', 'host.open': '打开这个会话的逐条归因',
      'hover.surface': 'surface {tokens}', 'hover.heaviest': '最重 {label}{tokens}',
      'hover.events': '日志 {count} 条', 'hover.open': '查看占用',
      'host.surface': '该会话 surface 总量', 'surface.empty': 'surface 为空',
      'host.heaviest': '最重 {seq}', 'host.measuring': '正在计量这台机器上的每个会话…',
      'cold.header': '已存储会话 {count} 个', 'cold.hint': '没有 live agent，按占盘排序',
      'cold.loading': '读取已存储会话…', 'cold.empty': '没有可列的已存储会话',
      'cold.unreadable': '此宿主读不到已存储的会话目录',
      'cold.events': '{count} 条', 'cold.sizeTitle': '已存储的会话日志字节数',
      'cold.pressureTitle': '投影缓存里的数字，可能停在该会话上次写入时',
      'error.cold': 'cold 请求失败：{error}',
      'baseline.title': 'provider usage 锚点；estimated 为估算，none 表示无锚点',
      'route.count': '{count} 条路由价差', 'session.select': '选择会话以计量',
      'tag.compaction': '压缩写入，替换了一段 surface', 'tag.compactionShort': '压缩',
      'tag.injected': '插件注入而非用户输入', 'tag.injectedShort': '注入', 'tag.interrupted': '中断',
      'tag.images': '{count}图', 'route.title': '路由价 {route} − heuristic 影子价 {shadow}',
      'snapshot.title': '面板取到这份快照的时间；不自动刷新，快照不会自己变新',
      'projection.pressure': '下次请求 {value} / {capacity}（{percent}%）',
      'projection.pressureOnly': '最近请求 {value}',
      'projection.usage': '累计 provider usage {total}',
      'projection.cache': 'cache read {read} / write {write}',
      'projection.breakdown': '估算构成：system {system} · tools {tools} · messages {messages}',
      'projection.summary': '来源与构成估算',
      'share.summary': '按类型的占用比例',
      'locate.short': '定位', 'locate.title': '在聊天窗口里滚动到这一条并高亮',
      'locate.aria': '在聊天窗口里定位 {seq}'
    }
    const EN = {
      'dock.label': 'Context ballast',
      'subtitle': 'What fills the window',
      'type.user': 'User', 'type.assistant': 'Assistant', 'type.tool': 'Tool',
      'row.noBody': '(no body)', 'row.missingEvent': '(event missing)',
      'row.unknownBody': '(unrecognized body)', 'row.images': '{count} images',
      'row.reasoningOnly': 'reasoning only', 'row.unknownBlocks': '{count} unknown blocks',
      'row.emptyResult': 'empty result', 'row.empty': '(empty)',
      'row.truncated': '{summary} (truncated from {count} characters)',
      'shadow.absent': 'No shadow price',
      'shadow.absentTitle': 'This DSH host does not provide heuristic shadow prices.',
      'shadow.partial': 'Partial shadow prices',
      'shadow.partialTitle': 'Some entries have no heuristic shadow price and cannot show a spread.',
      'unit.items': '{count} items', 'unit.events': '{count} events', 'unit.logEvents': 'log {revision} / {count} events',
      'unpriced.label': '{count} unreadable prices',
      'unpriced.title': 'The host did not provide numeric prices. These rows are excluded from totals and shares; they are not zero.',
      'age.seconds': '{count}s ago', 'age.minutes': '{count}m ago', 'age.hours': '{count}h ago',
      'error.measure': 'measure request failed: {error}', 'error.top': 'top request failed: {error}',
      'availability.ready': 'Meter ready', 'availability.unavailable': 'tokenMeter unavailable', 'availability.checking': 'Checking',
      'sessions.count': '{count} sessions in this host process', 'sessions.scanning': 'Scanning…',
      'refresh.title': 'Measure the current view again', 'refresh.loading': 'Refreshing', 'refresh.action': 'Refresh', 'close': 'Close',
      'sessions.loading': 'Loading…', 'sessions.none': 'No live sessions',
      'host.title': 'Find the heaviest entries across live sessions on this host',
      'host.single': 'One session', 'host.all': 'Across sessions', 'host.live': '{count} live sessions',
      'host.limit': 'Up to {count} entries per session', 'host.failed': '{count} sessions failed',
      'host.empty': 'No measurable live sessions', 'host.open': 'Open per-entry attribution for this session',
      'hover.surface': 'surface {tokens}', 'hover.heaviest': 'heaviest {label}{tokens}',
      'hover.events': 'log {count} events', 'hover.open': 'Show breakdown',
      'host.surface': 'Session surface total', 'surface.empty': 'Surface is empty',
      'host.heaviest': 'Heaviest {seq}', 'host.measuring': 'Measuring every live session on this host…',
      'cold.header': '{count} stored sessions', 'cold.hint': 'no live agent; largest on disk first',
      'cold.loading': 'Reading stored sessions…', 'cold.empty': 'No stored sessions to list',
      'cold.unreadable': 'This host cannot read its stored session directory',
      'cold.events': '{count} events', 'cold.sizeTitle': 'Bytes of stored session log',
      'cold.pressureTitle': 'From the projection cache; it can be as old as that session\u2019s last write',
      'error.cold': 'cold request failed: {error}',
      'baseline.title': 'Provider usage anchor; estimated is an estimate and none means no anchor.',
      'route.count': '{count} routed-price spreads', 'session.select': 'Select a session to measure',
      'tag.compaction': 'Compaction write replacing a surface span', 'tag.compactionShort': 'cmp',
      'tag.injected': 'Injected by a plugin rather than the user', 'tag.injectedShort': 'injected', 'tag.interrupted': 'interrupted',
      'tag.images': '{count} img', 'route.title': 'Route price {route} − heuristic shadow price {shadow}',
      'snapshot.title': 'When this snapshot reached the panel; it does not refresh automatically.',
      'projection.pressure': 'Next request {value} / {capacity} ({percent}%)',
      'projection.pressureOnly': 'Latest request {value}',
      'projection.usage': 'Cumulative provider usage {total}',
      'projection.cache': 'cache read {read} / write {write}',
      'projection.breakdown': 'Estimated mix: system {system} · tools {tools} · messages {messages}',
      'projection.summary': 'Origin and estimated mix',
      'share.summary': 'Share by entry type',
      'locate.short': 'Locate', 'locate.title': 'Scroll to this entry in the chat and highlight it',
      'locate.aria': 'Locate {seq} in the chat'
    }
    const browserFallback = (typeof navigator !== 'undefined' &&
      String(navigator.language || '').toLowerCase().startsWith('zh')) ? ZH : EN
    let translate = fallbackTranslator(browserFallback)

    function fallbackTranslator(dict) {
      return (key, params = {}) => {
        const template = dict[key] || EN[key] || key
        return template.replace(/\{([^}]+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
      }
    }

    function setTranslator(next) {
      translate = typeof next === 'function' ? next : fallbackTranslator(ZH)
      localeStore.listeners.forEach((listener) => listener())
    }

    const tr = (key, params) => translate(key, params)
    // 不依赖 React、DOM 与 I/O：test/view.test.js 直接求值这一段，而不是
    // 对打包结果做文本匹配。
    // 宿主从未发送的字段不是测得的 0：缺失的数字显示为破折号，面板因此不会
    // 暗示一次并不存在的计量。
    const fmt = (n) => (typeof n === 'number' && Number.isFinite(n)
      ? n.toLocaleString('en-US') : '—')

    /** 有符号数量总是带符号，包括合计里的 `delta`。 */
    const fmtSigned = (n) => (typeof n === 'number' && n > 0 ? '+' : '') + fmt(n)

    /** 有限数字，否则 undefined：这是宿主数字唯一允许的形状。 */
    function finite(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    }

    /**
     * 已完成缓存的会话事实的单行摘要。缓存里没有任何计量过的 token 数字时
     * 返回 ''，此时席位只提供动作：破折号或 0 会读成插件从未做过的计量。
     * 日志长度是真实的宿主数字，所以它是最后的选择，不是占位符。
     */
    function factSummary(fact) {
      if (!fact || typeof fact !== 'object') return ''
      const parts = []
      if (finite(fact.surfaceTokens) !== undefined) {
        parts.push(tr('hover.surface', { tokens: fmt(fact.surfaceTokens) }))
      }
      const heaviest = fact.heaviest
      if (heaviest && finite(heaviest.tokens) !== undefined) {
        const seq = finite(heaviest.seq)
        parts.push(tr('hover.heaviest', {
          label: seq === undefined ? '' : `#${seq} `, tokens: fmt(heaviest.tokens)
        }))
      }
      if (parts.length === 0 && finite(fact.eventCount) !== undefined) {
        parts.push(tr('hover.events', { count: fmt(fact.eventCount) }))
      }
      return parts.join(' · ')
    }

    function typeLabel(row) {
      const key = row.type === 'user/message' ? 'type.user'
        : row.type === 'assistant/message' ? 'type.assistant'
          : row.type === 'tool/result' ? 'type.tool' : null
      if (key) return tr(key)
      return row.type || '?'
    }

    /** 一行的单行摘要，并提示有哪些内容没有显示。 */
    function rowText(row) {
      const preview = row.preview
      if (!preview) return row.type ? tr('row.noBody') : tr('row.missingEvent')
      if (preview.text) return preview.text
      // shape === 'unknown' 表示载荷没有匹配任何已知的 surface 消息形状：
      // 存在插件读不懂的内容，这和“这一行为空”是不同的陈述。
      if (preview.shape === 'unknown') return tr('row.unknownBody')
      const only = []
      if (preview.images) only.push(tr('row.images', { count: preview.images }))
      if (preview.reasoning) only.push(tr('row.reasoningOnly'))
      if (preview.other) only.push(tr('row.unknownBlocks', { count: preview.other }))
      if (preview.kind === 'tool/result') only.unshift(tr('row.emptyResult'))
      return only.length ? `(${only.join(' · ')})` : tr('row.empty')
    }

    /** 文本提示：摘要加上被截掉的部分。 */
    function textHint(row) {
      const summary = rowText(row)
      const preview = row.preview
      if (preview && preview.truncated) {
        return tr('row.truncated', { summary, count: fmt(preview.chars) })
      }
      return summary
    }

    /**
     * seq 提示里的事件时间。只渲染 ISO 风格的字符串：裸数字可能是秒也可能
     * 是毫秒，本插件没有验证过是哪种，所以不做猜测。
     */
    function timeLabel(time) {
      if (typeof time !== 'string') return ''
      const ms = Date.parse(time)
      if (!Number.isFinite(ms)) return ''
      return new Date(ms).toLocaleString('zh-CN', { hour12: false })
    }

    /**
     * `none` 锚点没有 provider 基准，所以它的 token 数是缺席，不是宿主测得
     * 的价格。
     */
    function baselineLabel(baseline) {
      const kind = (baseline && baseline.kind) || 'unknown'
      const tokens = baseline ? baseline.tokens : null
      if (kind === 'none' || typeof tokens !== 'number' || !Number.isFinite(tokens)) {
        return `baseline ${kind}`
      }
      return `baseline ${kind} ${fmt(tokens)}`
    }

    /**
     * 影子价的可用状态。'available' 不需要说明，空 surface（'unknown'）
     * 无法区分两种宿主形状，两者都不渲染。'partial' 不能声称宿主完全没有
     * 影子价。
     */
    function shadowBadge(measurement) {
      if (measurement.shadowPricing === 'absent') {
        return {
          label: tr('shadow.absent'),
          title: tr('shadow.absentTitle')
        }
      }
      if (measurement.shadowPricing === 'partial') {
        return { label: tr('shadow.partial'), title: tr('shadow.partialTitle') }
      }
      return null
    }

    /**
     * 一行的条宽。没有价格的行完全不画条：2% 的细条会读成“这一行很便宜”，
     * 而真相是“这一行没有数字”。
     */
    function barWidth(row, max) {
      if (typeof row.tokens !== 'number' || !Number.isFinite(row.tokens)) return '0%'
      if (!(max > 0)) return '0%'
      return `${Math.max(2, (row.tokens / max) * 100)}%`
    }

    /** 宿主占比的百分数位。缺席的占比是 0，绝不显示 "NaN"。 */
    const sharePct = (share, digits) => (typeof share === 'number' && Number.isFinite(share)
      ? (share * 100).toFixed(digits) : '0')

    /** 宿主侧聚合结果中一个类型分组的图例文本。 */
    function shareLabel(group) {
      return `${typeLabel({ type: group.type })} ${sharePct(group.share, 1)}% · ` +
        `${fmt(group.tokens)} tokens / ${tr('unit.items', { count: group.count })}`
    }

    /** 宿主没有以数字形式给出价格的行数，没有则为空。 */
    function unpricedNote(measurement) {
      const count = measurement ? measurement.unpricedCount : 0
      if (!count) return null
      return {
        label: tr('unpriced.label', { count }),
        title: tr('unpriced.title')
      }
    }

    /**
     * 屏幕上的快照有多旧。页脚已经带有日志修订号，但没有实际时钟，修订号
     * 说明不了陈旧程度——所以 `now` 由调用方传入，让这里保持纯函数。
     */
    function snapshotAge(receivedAt, now) {
      if (typeof receivedAt !== 'number' || typeof now !== 'number') return ''
      const seconds = Math.floor((now - receivedAt) / 1000)
      if (!Number.isFinite(seconds) || seconds < 0) return ''
      if (seconds < 60) return tr('age.seconds', { count: seconds })
      if (seconds < 3600) return tr('age.minutes', { count: Math.floor(seconds / 60) })
      return tr('age.hours', { count: Math.floor(seconds / 3600) })
    }

    function pressureSummary(pressure) {
      if (!pressure) return null
      const value = typeof pressure.projectedTokens === 'number' ? pressure.projectedTokens : pressure.pressureTokens
      if (typeof value !== 'number') return null
      if (typeof pressure.contextWindow !== 'number' || pressure.contextWindow <= 0) {
        return tr('projection.pressureOnly', { value: fmt(value) })
      }
      return tr('projection.pressure', {
        value: fmt(value), capacity: fmt(pressure.contextWindow),
        percent: Math.min(999, (value / pressure.contextWindow) * 100).toFixed(1)
      })
    }

    function usageSummary(usage) {
      if (!usage) return null
      const total = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
        .reduce((sum, key) => sum + (typeof usage[key] === 'number' ? usage[key] : 0), 0)
      return tr('projection.usage', { total: fmt(total) })
    }

    /**
     * 已存储会话的大小，使用能保持数字简短的最大单位。后端没有报告大小
     * 不等于大小为零：它显示为 `fmt` 给不可读价格使用的同一个破折号。
     */
    function sizeLabel(bytes) {
      if (!Number.isInteger(bytes) || bytes <= 0) return '—'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      // `1.0 KB` 是没有意义的精度；`1.5 KB` 是真实的半格。
      return `${unit === 0 ? value : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`
    }

    /**
     * 已存储会话的压力行，取自投影缓存已经持有的数字。缓存行可能停在该会话
     * 最后一次写入时，所以调用方给这一行加提示，而不是把它当作此刻的读数。
     */
    function coldPressure(entry) {
      const pressure = entry && entry.projections && entry.projections.contextPressure
      return pressure ? pressureSummary(pressure) : null
    }

    /**
     * 交回加载状态——但只交给持有它的那次刷新。
     * `loading` 会禁用刷新按钮，所以晚返回的旧刷新不能在新刷新仍在进行时重新
     * 启用按钮：关闭再打开面板时，第一轮的过期读取会在用户正等待的读取期间
     * 报告“未加载”，并诱发一次重复点击。写成纯函数，持有规则不依赖组件运行时
     * 也能测试。
     */
    function releaseLoading(ownerRef, gen) {
      if (!ownerRef || ownerRef.current !== gen) return null
      ownerRef.current = 0
      return { loading: false }
    }

    // ---- 面板 ------------------------------------------------------------
// <dsh-utility-launcher>
// The shared launcher assembly: one icon plus the menu of panels it opens, for a
// plugin's browser half.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/launcher.js.
// DSH client artifacts are self-contained classic scripts, so the fragment is
// embedded into lib/client.js at build time by
//   npm run launcher:sync    (write it)
//   npm run launcher:check   (fail on drift)
// instead of being imported: a bare import would put a runtime dependency on
// this package into the bundle that embeds it, and an embedding plugin ships
// standalone, with nothing else required.
//
// The launcher is one icon that opens a menu of utility panels. It is contributed
// through slots, not through a page-local protocol: exactly one copy of this
// assembly runs per page — the first to load wins the window mutex, registers the
// launcher, and declares the menu seat — while the other copies register nothing
// here and only wait to take the claim over once their owner is disposed.
const UTILITY_ITEM_SLOT = 'createhelper.utility.item'
const UTILITY_MUTEX_KEY = '__CREATEHELPER_DSH_UTILITY_LAUNCHER_V1__'
const UTILITY_CSS_ID = 'createhelper-utility-launcher'
const UTILITY_FALLBACK_LEFT_PX = 80
const UTILITY_MEASURE_TRIES = 120
const UTILITY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect></svg>'

// The launcher's own chrome, injected once by whichever copy wins the mutex.
// The rows are other plugins' components, so the menu styles its buttons by
// position instead of asking every contributor for a class name.
function ensureUtilityStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="' + UTILITY_CSS_ID + '"]') !== null) return
  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-plugin-css', UTILITY_CSS_ID)
  styleEl.textContent =
    '.createhelper-utility-anchor{position:fixed;bottom:16px;z-index:9997;pointer-events:auto}' +
    '.createhelper-utility-launcher{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22)}' +
    '.createhelper-utility-launcher:hover,.createhelper-utility-launcher[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}' +
    '.createhelper-utility-launcher svg{display:block}' +
    '.createhelper-utility-menu{display:flex;flex-direction:column;gap:2px;min-width:172px;margin-bottom:6px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 30px rgba(0,0,0,.28)}' +
    '.createhelper-utility-menu[hidden]{display:none}' +
    '.createhelper-utility-menu button{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;text-align:left;white-space:nowrap}' +
    '.createhelper-utility-menu button:hover,.createhelper-utility-menu button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}' +
    '.createhelper-utility-menu button svg{display:block;flex:none}'
  document.head.appendChild(styleEl)
}

// The launcher tracks the shell's sidebar column rather than a fixed offset: its
// left edge sits 16px right of the sidebar's edge, and 80px while the shell has
// not laid that column out yet.
const measureUtilityLeft = () => {
  if (typeof document === 'undefined') return UTILITY_FALLBACK_LEFT_PX
  const overlay = document.querySelector('[data-shell-overlay]')
  const frame = overlay && overlay.parentElement
  const sidebar = frame && frame.firstElementChild
  const rect = sidebar && typeof sidebar.getBoundingClientRect === 'function'
    ? sidebar.getBoundingClientRect()
    : null
  if (!rect || !rect.right) return UTILITY_FALLBACK_LEFT_PX
  return Math.max(16, Math.round(rect.right + 16))
}
// The overlay layer commits before the frame's columns are laid out, so the
// first read answers the fallback; keep re-reading for ~2s and then stop.
const useUtilityLeft = () => {
  const [left, setLeft] = React.useState(UTILITY_FALLBACK_LEFT_PX)
  React.useEffect(() => {
    let stopped = false
    let tries = 0
    let frameId = 0
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    const sync = () => {
      if (stopped) return
      const next = measureUtilityLeft()
      setLeft(next)
      if (next === UTILITY_FALLBACK_LEFT_PX && raf !== null && tries < UTILITY_MEASURE_TRIES) {
        tries += 1
        frameId = raf(sync)
      }
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      stopped = true
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return left
}
// The block owns no dictionary, so its own title follows the browser
// language; each row's label comes from the plugin that contributes it.
const utilityTitle = () => {
  const nav = (typeof navigator !== 'undefined' && navigator.language) || ''
  return /^zh/i.test(nav) ? '工具面板' : 'Utility panels'
}
const utilityMenu = { open: false, listeners: new Set() }
const setUtilityMenu = (value) => {
  utilityMenu.open = !!value
  utilityMenu.listeners.forEach((listener) => listener())
}
const useUtilityMenu = () => {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const listener = () => setTick((value) => value + 1)
    utilityMenu.listeners.add(listener)
    return () => utilityMenu.listeners.delete(listener)
  }, [])
  return utilityMenu.open
}
// The launcher and its menu. The menu is always rendered - a declared child
// slot is not conditionally declared - and hidden when closed. Choosing a row
// closes the menu through the click that bubbles out of it, because the rows
// belong to other plugins, not to this block.
function UtilityLauncher (props) {
  const left = useUtilityLeft()
  const open = useUtilityMenu()
  ensureUtilityStyles()
  React.useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      const target = event && event.target
      if (target && typeof target.closest === 'function' && target.closest('[data-utility-anchor]') !== null) return
      setUtilityMenu(false)
    }
    const onKey = (event) => { if (event && event.key === 'Escape') setUtilityMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return h('div', {
    'data-utility-anchor': '',
    className: 'createhelper-utility-anchor',
    style: { left: left + 'px' }
  }, [
    h('div', {
      key: 'menu',
      className: 'createhelper-utility-menu',
      hidden: !open,
      onClick: () => setUtilityMenu(false)
    }, props && typeof props.renderSlot === 'function' ? props.renderSlot(UTILITY_ITEM_SLOT, {}) : null),
    h('button', {
      key: 'icon',
      type: 'button',
      className: 'createhelper-utility-launcher',
      title: utilityTitle(),
      'aria-label': utilityTitle(),
      'aria-expanded': open ? 'true' : 'false',
      onClick: () => setUtilityMenu(!open),
      dangerouslySetInnerHTML: { __html: UTILITY_ICON }
    })
  ])
}
// Whoever loads first owns the assembly; everyone else only contributes rows.
// The child slot is declared here, so a plugin that joins later still finds it
// through slots.inject, and an install with one plugin still gets a launcher.
//
// The seat belongs to the shell, so it is reached through inject: registering
// into it directly throws while that declaration is still pending, and a
// launcher must never cost the caller the surfaces it registers afterwards.
//
// The claim lives on the page and is released with its owner. Any plugin that
// embeds this block may win the claim, so without the release a hot reload of
// the owner would dispose its registration while the claim stayed taken, and the
// launcher would stay missing until the page was reloaded. A released claim wakes
// the other copies on the page, which re-register immediately.
const utilityClaim = () => {
  if (typeof window === 'undefined') return null
  const existing = window[UTILITY_MUTEX_KEY]
  if (existing !== null && typeof existing === 'object') return existing
  const claim = { owner: null, waiters: new Set() }
  window[UTILITY_MUTEX_KEY] = claim
  return claim
}
const registerUtilityLauncher = (scope) => {
  const claim = utilityClaim()
  if (claim === null) return
  if (claim.owner !== null) {
    claim.waiters.add(() => registerUtilityLauncher(scope))
    return
  }
  claim.owner = scope
  let released = false
  const release = () => {
    if (released) return
    released = true
    if (claim.owner === scope) claim.owner = null
    if (window[UTILITY_MUTEX_KEY] !== claim) return
    const waiters = [...claim.waiters]
    claim.waiters.clear()
    for (const wake of waiters) wake()
  }
  scope.on('dispose', release)
  scope.slots.inject('shell.overlay', () => {
    try {
      scope.slots.register({
        name: 'shell.overlay',
        id: 'utility-launcher',
        order: 98,
        children: { [UTILITY_ITEM_SLOT]: { kind: 'list', scope: 'root' } }
      }, UtilityLauncher)
    } catch (error) {
      release()
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('[utility-launcher] could not register the launcher', error)
      }
    }
  })
}
// </dsh-utility-launcher>
    // 本插件在启动器菜单里的一行。选择它打开面板；点击会从这一行冒泡出去，
    // 菜单因此自行关闭。
    function BlMenuItem () {
      useLocaleRevision()
      const open = useOpen()
      return h('button', {
        type: 'button',
        'aria-pressed': open ? 'true' : 'false',
        title: tr('dock.label'),
        onClick: () => setOpen(true)
      }, [
        h('span', { key: 'icon', dangerouslySetInnerHTML: { __html: BALLAST_ICON } }),
        h('span', { key: 'label' }, tr('dock.label'))
      ])
    }

    function BallastSurface() {
      const rootRef = React.useRef(null)
      const open = useOpen()
      useLocaleRevision()
      const focusRevision = useFocusRevision()
      const [state, setState] = React.useState({
        loading: false,
        availability: 'unknown',
        // 快照来自哪个宿主进程，由路由报告。
        hostProcess: null,
        sessions: [],
        selected: null,
        measure: null,
        projections: null,
        receivedAt: null,
        view: 'session',
        top: null,
        // 已存储会话，跨会话视图会把它们列在活跃会话旁边：重启之后没有会话
        // 是活跃的，而这时仍然占着数据目录的会话恰恰值得列出来。
        cold: null,
        coldLoading: false,
        // 宿主能否读取数据目录。空列表与读不到是两个不同的答案，只有前者是
        // 关于宿主持有内容的陈述。
        coldStoredAvailable: true,
        error: null
      })
      // 同一时刻可能有两个读取在途：用户重新选择会话，或在扫描运行时切换
      // 视图。后作答的一方会覆盖先前的答案，而一个用 B 的标题显示 A 的行的
      // 面板不是慢，是错的。每次读取记下开始时的代号，代号不再是最新时就
      // 丢弃自己的答案。
      const generation = React.useRef(0)
      // 在 await 之后恢复的读取，必须对面板最新的目标作判断，而不是入队时
      // 闭包捕获的那个目标。每次用户意图都会增加上面的代号，所以仍属当前的
      // 读取除自身之外没有看到任何状态变化。
      const stateRef = React.useRef(state)
      stateRef.current = state
      // 当前持有加载状态的一方。刷新开始时设置，只有那次刷新能释放
      // （见上方 `releaseLoading`）。
      const loadingOwner = React.useRef(0)

      const loadMeasure = React.useCallback(async (sessionId) => {
        if (!sessionId) return
        const gen = ++generation.current
        let res
        let body
        try {
          res = await fetch(`/dsh-ballast/api?action=measure&sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: 'application/json' } })
          body = await res.json().catch(() => ({}))
        } catch (e) {
          // DSH 重启、HMR 断开 socket 或网络故障时 fetch() 会拒绝。未捕获时
          // 这是一个浏览器未处理的拒绝，面板会继续显示旧快照，仿佛读取成功。
          if (gen !== generation.current) return
          setState((s) => ({ ...s, measure: null, projections: null, receivedAt: null,
            error: tr('error.measure', { error: String((e && e.message) || e) }) }))
          return
        }
        if (gen !== generation.current) return
        if (!body.ok) {
          setState((s) => ({ ...s, measure: null, projections: null, receivedAt: null,
            error: tr('error.measure', { error: `${res.status}: ${body.error || body.code || ''}` }) }))
          return
        }
        // 记下宿主刚为这个会话返回的内容，悬停区可以直接重复显示，不必再问
        // 一次。每个值都复制自载荷；此时不做推导或估算。
        rememberSessionFacts(body.sessionId || sessionId, {
          title: body.title,
          titleSource: body.titleSource,
          eventCount: body.measurement && body.measurement.eventCount,
          totalTokens: body.measurement && body.measurement.totalTokens,
          surfaceTokens: body.measurement && body.measurement.surfaceTokens,
          nodeCount: body.measurement && body.measurement.nodeCount,
          heaviest: body.measurement && body.measurement.rows ? body.measurement.rows[0] : null
        })
        setState((s) => ({ ...s, measure: body.measurement, projections: body.projections || null,
          receivedAt: Date.now(), error: null }))
      }, [])

      const loadTop = React.useCallback(async () => {
        const gen = ++generation.current
        let res
        let body
        try {
          res = await fetch('/dsh-ballast/api?action=top&limit=5', { headers: { accept: 'application/json' } })
          body = await res.json().catch(() => ({}))
        } catch (e) {
          if (gen !== generation.current) return
          setState((s) => ({ ...s, top: null,
            error: tr('error.top', { error: String((e && e.message) || e) }) }))
          return
        }
        if (gen !== generation.current) return
        if (!body.ok) {
          setState((s) => ({ ...s, top: null,
            error: tr('error.top', { error: `${res.status}: ${body.error || body.code || ''}` }) }))
          return
        }
        // 跨会话扫描已经计量了每个活跃会话，它的逐会话条目就是本插件现在
        // 持有的事实。缓存这些条目，悬停行才能不作扫描就作答。
        for (const entry of body.sessions || []) {
          rememberSessionFacts(entry.sessionId, {
            title: entry.title,
            titleSource: entry.titleSource,
            surfaceTokens: entry.surfaceTokens,
            nodeCount: entry.nodeCount,
            heaviest: entry.rows ? entry.rows[0] : null
          })
        }
        setState((s) => ({ ...s, top: body, receivedAt: Date.now(), error: null }))
      }, [])

      /**
       * 已存储会话列表。它回答的问题与 `top` 不同（什么占着数据目录，而不是
       * 什么占着窗口），所以它是独立的读取，也有独立的失败。
       */
      const loadCold = React.useCallback(async () => {
        const gen = ++generation.current
        setState((s) => ({ ...s, coldLoading: true }))
        let res
        let body
        try {
          res = await fetch('/dsh-ballast/api?action=cold', { headers: { accept: 'application/json' } })
          body = await res.json().catch(() => ({}))
        } catch (e) {
          // 过期的读取也要交回加载状态：它在检查代号之前就取走了
          // `coldLoading`，直接返回会让存储部分永远停在读取中。
          if (gen !== generation.current) {
            setState((s) => ({ ...s, coldLoading: false }))
            return
          }
          setState((s) => ({ ...s, cold: null, coldLoading: false,
            error: tr('error.cold', { error: String((e && e.message) || e) }) }))
          return
        }
        if (gen !== generation.current) {
          setState((s) => ({ ...s, coldLoading: false }))
          return
        }
        if (!body.ok) {
          setState((s) => ({ ...s, cold: null, coldLoading: false,
            error: tr('error.cold', { error: `${res.status}: ${body.error || body.code || ''}` }) }))
          return
        }
        // 这些会话没有活跃 Agent，所以这里的内容不能交给事实缓存：缓存里的
        // 条目描述的是面板做过的计量。
        setState((s) => ({ ...s, cold: body.sessions || [], coldStoredAvailable: body.storedAvailability !== 'unavailable',
          coldLoading: false, error: null }))
      }, [])

      /**
       * 两次跨宿主读取，先读存储部分。存储列表是目录读取，活跃扫描要计量
       * 每个会话，所以便宜的一半在昂贵的一半仍在运行时就能落地。两者顺序
       * 执行，因为每次读取都会写共享代号：第一次仍在进行时启动第二次会丢弃
       * 第一次的答案。
       */
      const loadHostView = React.useCallback(async () => {
        await loadCold()
        await loadTop()
      }, [loadCold, loadTop])

      const refresh = React.useCallback(async () => {
        // 会话列表只是一次刷新的前半段，所以整个流程共用一个代号：在途期间
        // 发生的选择或视图切换必须丢弃它，不能被它覆盖。
        const gen = ++generation.current
        // 从此刻起这次刷新持有加载状态：之后的刷新会接管，更早的刷新无法再
        // 释放它。
        loadingOwner.current = gen
        // 悬停操作产生的请求也是选择意图。在它触发的那次读取的开头取走，
        // 会话列表与随后的计量因此属于同一代、同一目标；从悬停打开所花的
        // 读取次数与直接打开相同。
        const requested = consumeFocus()
        setState((s) => ({ ...s, loading: true, error: null }))
        let body
        try {
          const res = await fetch('/dsh-ballast/api?action=sessions', { headers: { accept: 'application/json' } })
          body = await res.json()
          if (!body.ok) throw new Error(body.error || body.code || ('HTTP ' + res.status))
        } catch (e) {
          const message = String((e && e.message) || e)
          // 错误消息只属于最新意图：报告用户已经越过的失败是噪声。加载状态
          // 属于它的持有者，不一定是这次读取。
          const released = releaseLoading(loadingOwner, gen)
          // 卸载之后代号已失效、加载持有者也已复位，没有内容可写：在为一个
          // 已不存在的面板安排状态更新之前返回。
          if (!released && gen !== generation.current) return
          setState((s) => ({ ...s, ...released, ...(gen === generation.current ? { error: message } : {}) }))
          return
        }
        if (gen !== generation.current) {
          const released = releaseLoading(loadingOwner, gen)
          // 与 catch 分支相同的规则：已被取代、且不再持有任何东西的读取
          // （例如卸载之后）完全不能触碰状态。
          if (released) setState((s) => ({ ...s, ...released }))
          return
        }
        const sessions = body.sessions || []
        // 列表本身就是宿主的答案：它携带的标题与日志长度即使没有 token
        // 数字，也是值得保留的事实。
        for (const session of sessions) {
          rememberSessionFacts(session.sessionId, {
            title: session.title, titleSource: session.titleSource, eventCount: session.eventCount
          })
        }
        // 选择和视图从最新状态读取，而不是从闭包读取：读取在途期间用户可能
        // 已经重新选择。
        const current = stateRef.current
        // 请求指定的会话优先于先前的选择：它是最新意图，由它引起的读取不能
        // 落到另一个会话上。
        const keep = sessions.some((x) => x.sessionId === requested) ? requested
          : sessions.some((x) => x.sessionId === current.selected) ? current.selected
            : (sessions[0] || {}).sessionId || null
        const wantTop = !requested && current.view === 'host'
        setState((s) => ({
          ...s,
          // 只有这次刷新仍属当前时才可达，所以它就是持有者。
          ...releaseLoading(loadingOwner, gen),
          availability: body.availability || 'unavailable',
          // 哪个进程作答属于会话快照的一部分。没有指明宿主的响应沿用先前的
          // 身份，不虚构一个。
          hostProcess: body.pid > 0 && body.port > 0 ? { pid: body.pid, port: body.port } : s.hostProcess,
          sessions,
          selected: keep,
          // 悬停操作打开逐条视图；跨会话扫描是按需触发的，从来不是某一行的
          // 操作所要求的。
          view: requested ? 'session' : s.view,
          // 计量属于它被取时的那个会话；跨选择保留会把一个会话的行放在
          // 另一个会话的名字下面。
          measure: keep === s.selected ? s.measure : null,
          projections: keep === s.selected ? s.projections : null,
          top: wantTop ? null : s.top
        }))
        // 刷新保持屏幕上的视图：不能把用户拽回单会话，也不能发起用户没有
        // 要求的跨会话扫描。
        if (wantTop) await loadHostView()
        else if (keep) await loadMeasure(keep)
      }, [loadMeasure, loadHostView])

      React.useEffect(() => {
        if (!open) return
        void refresh()
        const dismiss = (event) => {
          const target = event.target
          // 启动器的外层容器带着启动器自己检查的锚点属性；按在图标或它的
          // 菜单上属于启动器，不算点击面板外部。
          const dockButton = target && typeof target.closest === 'function'
            ? target.closest('[data-utility-anchor]')
            : null
          if (!dockButton && rootRef.current && !rootRef.current.contains(target)) setOpen(false)
        }
        const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', dismiss)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
          document.removeEventListener('pointerdown', dismiss)
          document.removeEventListener('keydown', closeOnEscape)
          // 卸载（HMR、插件销毁、关闭面板）必须让在途读取失效：它们持有本
          // 组件的 setState，否则会继续对一个已不存在的面板运行。增加代号
          // 让每个待完成的读取在自己的守卫处返回，不触碰状态；清空加载持有
          // 者让之后打开的面板从干净状态开始。
          generation.current += 1
          loadingOwner.current = 0
        }
      }, [open])

      // 面板已经打开时，悬停行仍可以请求一个会话。首次打开由上面的 effect
      // 覆盖，它的读取会在开头消费请求，所以这里只会看到面板已经在屏幕上
      // 时到达的请求。
      React.useEffect(() => {
        if (!open || !focusStore.pending) return
        void refresh()
      }, [open, focusRevision])

      // 从下拉列表选择会话只计量它，不刷新整个列表——列表已知，面板应当立即
      // 响应。`void`：读取入队后点击即完成，加载器自己负责报告失败；在这里
      // await 只会让处理函数返回一个没人等待的 promise。
      const selectSession = (sessionId) => {
        setState((s) => ({ ...s, selected: sessionId, measure: null, projections: null, error: null }))
        void loadMeasure(sessionId)
      }

      const toggleHostView = () => {
        if (state.view === 'host') {
          generation.current += 1
          setState((s) => ({ ...s, view: 'session', top: null, cold: null, coldLoading: false, coldStoredAvailable: true, error: null }))
          return
        }
        setState((s) => ({ ...s, view: 'host', top: null, cold: null, coldLoading: false, coldStoredAvailable: true, error: null }))
        void loadHostView()
      }

      const openSession = (sessionId) => {
        setState((s) => ({ ...s, view: 'session', top: null, cold: null, coldLoading: false, coldStoredAvailable: true }))
        selectSession(sessionId)
      }

      if (!open) return null

      const measurement = state.measure
      const rows = measurement ? measurement.rows : []
      // 条形比例以最重的 *有价* 行为基准；排在最前却没有数字的行不能把整个
      // 面板的比例变成 NaN。
      const max = rows.length && typeof rows[0].tokens === 'number' ? rows[0].tokens : 0
      const availabilityLabel = state.availability === 'available' ? tr('availability.ready')
        : state.availability === 'unavailable' ? tr('availability.unavailable')
          : tr('availability.checking')
      const badge = measurement ? shadowBadge(measurement) : null
      const unpriced = measurement ? unpricedNote(measurement) : null
      const share = measurement && measurement.byType ? measurement.byType.types : []
      const age = snapshotAge(state.receivedAt, Date.now())
      const host = state.top
      const coldRows = state.cold || []
      const coldReadable = state.coldStoredAvailable !== false
      const isHostView = state.view === 'host'
      // 聊天窗口显示的会话与被测会话相同时才给行渲染定位入口。这是一次纯 DOM
      // 读取，不触网，也不读宿主服务。
      const chatSession = isHostView ? null : locatedSessionId()
      const locatable = chatSession !== null && chatSession === state.selected
      const projection = state.projections
      const pressure = projection && pressureSummary(projection.contextPressure)
      const usage = projection && usageSummary(projection.tokenUsage)
      const breakdown = projection && projection.contextBreakdown

      return h('div', { className: 'dshbl-layer', ref: rootRef },
        h('div', { className: 'dshbl-head' },
          h('span', { className: 'dshbl-title' }, 'ballast'),
          h('span', { className: 'dshbl-sub' }, tr('subtitle')),
          // 头部写明作答的宿主进程，读者同时看两个共用同一数据目录的 DSH
          // 进程时，能判断下面的计数覆盖的是哪一个。
          h('span', { className: 'dshbl-hostproc' }, state.hostProcess
            ? `pid ${state.hostProcess.pid} · port ${state.hostProcess.port}`
            : ''),
          h('span', { className: 'dshbl-spacer' }),
          h('span', { className: 'dshbl-count' },
            isHostView
              ? (host ? tr('sessions.count', { count: host.sessions.length }) : tr('sessions.scanning'))
              : tr('unit.items', { count: rows.length })),
          h('button', {
            className: 'dshbtn', key: 'refresh', title: tr('refresh.title'), disabled: state.loading,
            onClick: () => void refresh()
          }, state.loading ? tr('refresh.loading') : tr('refresh.action')),
          h('button', { className: 'dshbtn', key: 'close', title: tr('close'), onClick: () => setOpen(false) }, '×')
        ),
        h('div', { className: 'dshbl-body' },
          h('div', { className: 'dshbl-controls' },
            h('select', {
              className: 'dshbl-select',
              value: state.selected || '',
              onChange: (e) => selectSession(e.target.value)
            },
              state.sessions.length === 0
                ? h('option', { value: '' }, state.loading ? tr('sessions.loading') : tr('sessions.none'))
                : state.sessions.map((s) => h('option', { key: s.sessionId, value: s.sessionId },
                    `${s.title || s.sessionId} · ${tr('unit.events', { count: s.eventCount })}`))
            ),
            h('button', {
              className: 'dshbtn', key: 'hostview',
              title: tr('host.title'),
              'aria-pressed': isHostView ? 'true' : 'false',
              onClick: toggleHostView
            }, isHostView ? tr('host.single') : tr('host.all'))
          ),
          state.error && h('div', { className: 'dshbl-error' }, state.error),
          isHostView
            ? h(React.Fragment, null,
              host
                ? h(React.Fragment, null,
                  h('div', { className: 'dshbl-totals' },
                    h('span', { className: 'dshbl-total-strong' }, tr('host.live', { count: host.sessions.length })),
                    h('span', null, tr('host.limit', { count: host.limit })),
                    host.failedCount > 0 && h('span', {
                      className: 'dshbl-spread',
                      title: host.failures.map((f) => `${f.sessionId}: ${f.error}`).join('\n')
                    }, tr('host.failed', { count: host.failedCount }))
                  ),
                  host.sessions.length === 0 && h('div', { className: 'dshbl-empty' }, tr('host.empty')),
                  host.sessions.map((entry) => h('div', {
                    className: 'dshbl-hostrow', key: entry.sessionId,
                    title: tr('host.open'), onClick: () => openSession(entry.sessionId)
                  },
                    h('span', { className: 'dshbl-seq', title: tr('host.surface') }, fmt(entry.surfaceTokens)),
                    h('span', { className: 'dshbl-text' }, entry.title || entry.sessionId),
                    entry.rows.length === 0
                      ? h('span', { className: 'dshbl-meta' }, tr('surface.empty'))
                      : h(React.Fragment, null,
                        h('span', { className: 'dshbl-type' }, typeLabel({ type: entry.rows[0].type })),
                        h('span', { className: 'dshbl-meta' }, tr('host.heaviest', { seq: entry.rows.length ? `#${entry.rows[0].seq}` : '' })),
                        h('span', { className: 'dshbl-tokens' }, fmt(entry.rows[0].tokens)))
                  ))
                )
                : h('div', { className: 'dshbl-empty' }, tr('host.measuring')),
              // 已存储会话是“这台宿主持有什么”的另一半：没有活跃 Agent 的
              // 会话没有可计量的窗口，但仍占着字节，重启之后它是唯一还能显示
              // 的一半。它不等待活跃扫描，后者才是慢的那个。
              h('div', { className: 'dshbl-section' },
                h('span', { className: 'dshbl-total-strong' },
                  state.coldLoading ? tr('cold.loading') : tr('cold.header', { count: coldRows.length })),
                !state.coldLoading && coldReadable && h('span', null, tr('cold.hint'))),
              !state.coldLoading && !coldReadable && h('div', { className: 'dshbl-empty' }, tr('cold.unreadable')),
              !state.coldLoading && coldReadable && coldRows.length === 0 && h('div', { className: 'dshbl-empty' }, tr('cold.empty')),
              coldRows.map((entry) => {
                const pressure = coldPressure(entry)
                return h('div', { className: 'dshbl-hostrow dshbl-static', key: entry.sessionId },
                  h('span', { className: 'dshbl-seq', title: tr('cold.sizeTitle') }, sizeLabel(entry.sizeBytes)),
                  h('span', { className: 'dshbl-text', title: entry.sessionId }, entry.title || entry.sessionId),
                  // 后端没有提供计数就不报告计数，这一行保持沉默，而不是声称
                  // 有零个事件。
                  entry.eventCount !== null && h('span', { className: 'dshbl-meta' }, tr('cold.events', { count: entry.eventCount })),
                  pressure && h('span', { className: 'dshbl-meta', title: tr('cold.pressureTitle') }, pressure))
              })
            )
            : h(React.Fragment, null,
              // 条目列表上方的内容都是参考信息，所以收成一个可展开区域，
              // 而不是三个堆叠块加占比条再加图例：面板高度有限时，面板本该
              // 展示的条目大多会落到屏幕外。折叠的摘要保留值得扫一眼的数字，
              // 明细点一下就展开。
              measurement && h('details', { className: 'dshbl-details' },
                h('summary', { className: 'dshbl-details-summary' },
                  h('span', { className: 'dshbl-sum-item' }, `total ${fmt(measurement.totalTokens)}`),
                  h('span', { className: 'dshbl-sum-item' }, `surface ${fmt(measurement.surfaceTokens)}`),
                  badge && h('span', { className: 'dshbl-meta', title: badge.title }, badge.label)),
                h('div', { className: 'dshbl-totals' },
                  h('span', { className: 'dshbl-total-strong' }, `total ${fmt(measurement.totalTokens)}`),
                  h('span', null, `surface ${fmt(measurement.surfaceTokens)}`),
                  h('span', null, `delta ${fmtSigned(measurement.surfaceDeltaTokens)}`),
                  h('span', { title: tr('baseline.title') },
                    baselineLabel(measurement.baseline)),
                  measurement.routePricedCount > 0 && h('span', { className: 'dshbl-spread' },
                    tr('route.count', { count: measurement.routePricedCount })),
                  badge && h('span', { className: 'dshbl-meta', title: badge.title }, badge.label)
                ),
                projection && (pressure || usage || breakdown) && h('div', { className: 'dshbl-projections' },
                  pressure && h('div', { className: 'dshbl-projection-line' }, pressure),
                  usage && h('div', { className: 'dshbl-projection-line' },
                    h('span', null, usage),
                    projection.tokenUsage && h('span', null, tr('projection.cache', {
                      read: fmt(projection.tokenUsage.cacheReadTokens),
                      write: fmt(projection.tokenUsage.cacheWriteTokens)
                    }))),
                  breakdown && h('div', { className: 'dshbl-projection-line' }, tr('projection.breakdown', {
                    system: fmt(breakdown.systemTokens), tools: fmt(breakdown.toolsTokens),
                    messages: fmt(breakdown.messageTokens)
                  }))
                ),
                // 聚合结果来自宿主：占比规则只定义一次，不让三个视图各自用
                // 不同方式求和。
                share.length > 0 && h('div', { className: 'dshbl-share' },
                  share.map((group) => group.share > 0 && h('span', {
                    className: 'dshbl-share-seg',
                    key: group.type || 'unknown',
                    style: { width: `${sharePct(group.share, 2)}%` },
                    title: shareLabel(group)
                  }))
                ),
                share.length > 0 && h('div', { className: 'dshbl-legend' },
                  share.map((group) => h('span', { key: group.type || 'unknown', title: shareLabel(group) },
                    `${typeLabel({ type: group.type })} ${sharePct(group.share, 0)}%`))
                )),
              rows.length === 0 && !state.error
                ? h('div', { className: 'dshbl-empty' }, measurement ? tr('surface.empty') : tr('session.select'))
                : rows.map((row) => h('div', { className: 'dshbl-row', key: row.seq },
                  h('div', { className: 'dshbl-bar', style: { width: barWidth(row, max) } }),
                  h('span', { className: 'dshbl-seq', title: timeLabel(row.time) || undefined }, `#${row.seq}`),
                  h('span', { className: 'dshbl-type' }, typeLabel(row)),
                  h('span', { className: 'dshbl-text', title: textHint(row) }, rowText(row)),
                  row.surfaceOp === 'replace' && h('span', { className: 'dshbl-tag dshbl-tag-warn', title: tr('tag.compaction') }, tr('tag.compactionShort')),
                  row.preview && row.preview.isError && h('span', { className: 'dshbl-tag dshbl-tag-warn' }, 'err'),
                  row.preview && row.preview.injected && h('span', { className: 'dshbl-tag', title: tr('tag.injected') }, tr('tag.injectedShort')),
                  row.preview && row.preview.interrupted && h('span', { className: 'dshbl-tag' }, tr('tag.interrupted')),
                  row.preview && row.preview.images ? h('span', { className: 'dshbl-tag' }, tr('tag.images', { count: row.preview.images })) : null,
                  row.routePriced && h('span', {
                    className: 'dshbl-meta dshbl-spread',
                    title: tr('route.title', { route: fmt(row.tokens), shadow: fmt(row.heuristicTokens) })
                  }, fmtSigned(row.priceDelta)),
                  h('span', { className: 'dshbl-tokens' }, fmt(row.tokens)),
                  // 定位入口只在聊天窗口显示的就是被测会话、且这一行有可定位
                  // 的身份时出现。任何一边不成立都不渲染：指向另一个会话的
                  // 定位比没有定位更糟。
                  locatable && row.chat && h('button', {
                    key: 'locate', type: 'button', className: 'dshbl-locate',
                    title: tr('locate.title'), 'aria-label': tr('locate.aria', { seq: `#${row.seq}` }),
                    onClick: () => locateRow(row.chat)
                  }, tr('locate.short'))
                ))
            )
        ),
        h('div', { className: 'dshbl-foot' },
          h('span', null, availabilityLabel),
          !isHostView && unpriced && h('span', { className: 'dshbl-meta dshbl-spread', title: unpriced.title }, unpriced.label),
          h('span', { className: 'dshbl-spacer' }),
          age && h('span', { title: tr('snapshot.title') }, age),
          !isHostView && measurement && h('span', null,
            tr('unit.logEvents', { revision: fmt(measurement.logRevision), count: fmt(measurement.eventCount) }))
        )
      )
    }

    // ---- 聊天定位 --------------------------------------------------------
    // 面板上的按钮把某一条滚动到聊天窗口里并高亮它。这些 DOM 属性是宿主的内部
    // 约定，不是公开 API：宿主换掉它们，下面任何一步都可能落空。因此每个
    // querySelector 都在 try/catch 里，失败时什么也不做——行照常显示，异常
    // 不冒泡到面板渲染。定位不上是宿主形状变了，不是用户操作失败。
    //
    // 这里的 DOM 查询都在用户点击的那一刻发生，纯粹为了读宿主已经渲染出来的
    // 页面：不发请求，不读插件的状态，也不改宿主节点（高亮是浮在上面的一层）。

    const LOCATE_ROOT = '[data-slot="main.conversation"] [data-slot="conversation.view"] [data-chat-flow]'
    const LOCATE_ROW = '[data-chat-node-key], [data-chat-turn], [data-chat-call-id], [data-chat-group-key]'
    const LOCATE_FLASH_MS = 900

    /**
     * 当前聊天窗口显示的是哪个会话。
     *
     * 只有它等于被测会话时才给行渲染定位按钮：定位到另一个会话的窗口里，
     * 高亮的是不相干的条目，比没有按钮更糟。读不到就是 null，按钮因此不渲染。
     */
    function locatedSessionId() {
      try {
        const root = mainChatRoot()
        if (root === null) return null
        const owner = root.closest('[data-conversation-session]')
        const id = owner && owner.getAttribute('data-conversation-session')
        return typeof id === 'string' && id !== '' ? id : null
      } catch (e) {
        return null
      }
    }

    /** 元素与它的祖先是否都已挂载且可见（CSS 与 hidden 祖先都不阻止显示）。 */
    function displayed(element) {
      if (!element || element.isConnected !== true) return false
      if (typeof element.closest === 'function' && element.closest('[hidden]') !== null) return false
      try {
        for (let node = element; node !== null; node = node.parentElement) {
          const style = window.getComputedStyle(node)
          if (style.display === 'none' || style.visibility === 'hidden') return false
        }
      } catch (e) {
        return false
      }
      return true
    }

    /**
     * 元素是否已经渲染出盒子。
     *
     * 候选里混着还没有布局的条目（虚拟化的占位、懒渲染的子树），取第一个
     * 匹配到的元素会把用户带到空白处，所以先要一个有宽高的盒子。
     */
    function hasRenderedBox(element) {
      if (!displayed(element)) return false
      try {
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      } catch (e) {
        return false
      }
    }

    /** 主聊天列。不在侧栏或嵌套视图里的那一列，且必须已显示。 */
    function mainChatRoot() {
      const found = document.querySelectorAll(LOCATE_ROOT)
      for (const element of found) {
        if (element.closest('[data-sidebar-right-session], [data-step-process-body]') !== null) continue
        if (displayed(element)) return element
      }
      return null
    }

    /**
     * 一行在聊天窗口里的候选，按精确度排序：节点身份最精确，其次是同一
     * turn 里的任何一条。
     *
     * 同一 turn 会有多个候选（助手消息与它发起的工具调用），所以精确身份
     * 不可用时才退到 turn，并且仍然只取第一个已渲染可见的。
     */
    function locateCandidates(root, chat) {
      const found = root.querySelectorAll(LOCATE_ROW)
      const exact = []
      const sameTurn = []
      for (const element of found) {
        const nodeKey = element.getAttribute('data-chat-node-key')
        if (chat.nodeKey !== null && nodeKey === chat.nodeKey) {
          exact.push(element)
          continue
        }
        if (chat.turn !== null && element.getAttribute('data-chat-turn') === String(chat.turn)) {
          sameTurn.push(element)
        }
      }
      return exact.concat(sameTurn)
    }

    /**
     * 把被 `hidden="until-found"` 折叠的候选叫醒。
     *
     * 聊天窗口用浏览器的 find-in-page 机制保留折叠内容，所以展开的方式是派发
     * `beforematch`，而不是改属性：属性由宿主拥有。没有折叠祖先时什么也不做。
     */
    function wakeHiddenCandidates(root, candidates) {
      for (const candidate of candidates) {
        const hidden = []
        for (let node = candidate; node !== null && node !== root; node = node.parentElement) {
          if (node.getAttribute('hidden') === 'until-found') hidden.push(node)
        }
        if (hidden.length === 0) continue
        const scroller = root.closest('[data-conversation-scroll]')
        if (scroller !== null) scroller.dispatchEvent(new window.Event('beforematch'))
        for (const node of hidden) node.dispatchEvent(new window.Event('beforematch'))
      }
    }

    /** 目标在滚动容器与输入栏之上的可见矩形；完全被裁掉时返回 null。 */
    function visibleChatRect(element) {
      const rect = element.getBoundingClientRect()
      let left = Math.max(0, rect.left)
      let right = Math.min(window.innerWidth, rect.right)
      let top = Math.max(0, rect.top)
      let bottom = Math.min(window.innerHeight, rect.bottom)
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        if (!parent.matches('[data-conversation-scroll], [data-step-process-body]')) continue
        const bounds = parent.getBoundingClientRect()
        left = Math.max(left, bounds.left)
        right = Math.min(right, bounds.right)
        top = Math.max(top, bounds.top)
        bottom = Math.min(bottom, bounds.bottom)
        if (parent.hasAttribute('data-conversation-scroll')) {
          const composer = parent.querySelector(':scope > [data-composer-seat]')
          const box = composer === null ? null : composer.getBoundingClientRect()
          if (box !== null && box.height > 0) bottom = Math.min(bottom, box.top)
        }
      }
      return bottom <= top || right <= left ? null : { left, top, width: right - left, height: bottom - top }
    }

    /** 浮在目标之上的一层高亮，片刻后自己移除。 */
    function flashChatRow(row) {
      const rect = visibleChatRect(row)
      if (rect === null) return
      const overlay = document.createElement('div')
      overlay.className = 'dshbl-chatflash'
      overlay.setAttribute('aria-hidden', 'true')
      Object.assign(overlay.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      })
      document.body.appendChild(overlay)
      window.setTimeout(() => overlay.remove(), LOCATE_FLASH_MS)
    }

    /** 用户要求减少动效时不滚动动画，也不闪。 */
    function reducedMotion() {
      try {
        return typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
      } catch (e) {
        return false
      }
    }

    /**
     * 滚动到某一行并高亮它。定位不上时返回 false，按钮不做任何事。
     *
     * 这是唯一的入口，所以所有宿主 DOM 的读取都在这一个 try 里：任何一步
     * 失败都只是没有定位，不是一个面板渲染错误。
     */
    function locateRow(chat) {
      try {
        if (!chat || typeof chat.nodeKey !== 'string') return false
        const root = mainChatRoot()
        if (root === null) return false
        const candidates = locateCandidates(root, chat)
        if (candidates.length === 0) return false
        wakeHiddenCandidates(root, candidates)
        // 叫醒之后重新枚举：被展开的子树可能带来新的候选。
        const row = candidates.concat(locateCandidates(root, chat)).find(hasRenderedBox)
        if (row === undefined) return false
        const still = mainChatRoot()
        if (still === null) return false
        const visible = visibleChatRect(row)
        if (visible === null) {
          // 不在视口里：减少动效时直接跳过去，否则滚到中间再高亮。
          row.scrollIntoView(reducedMotion()
            ? { behavior: 'instant', block: 'center', inline: 'nearest' }
            : { behavior: 'smooth', block: 'center', inline: 'nearest' })
          if (reducedMotion()) return false
        }
        window.setTimeout(() => {
          try {
            flashChatRow(row)
          } catch (e) {
            // 高亮是可选的补充：失败时滚动已经完成，用户仍然看到了那一条。
          }
        }, reducedMotion() ? 0 : 200)
        return true
      } catch (e) {
        return false
      }
    }

    // ---- 会话行悬停 ------------------------------------------------------
    // Session 行的悬停卡片区。只在卡片打开时挂载，所以它显示的一切必须已经
    // 在内存里：悬停永远不能发起宿主读取，这也是它只渲染先前面板读取缓存过的
    // 内容的原因。没有缓存事实时，它仍然提供面板入口——这是发现入口，点击
    // 之前不产生任何成本。
    function BallastSessionHover(props) {
      useLocaleRevision()
      useFactsRevision()
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      if (sessionId === '') return null
      const summary = factSummary(readSessionFacts(sessionId))
      return h('div', { className: 'dshbl-hover' },
        summary !== '' && h('span', { className: 'dshbl-hover-fact', title: summary }, summary),
        h('button', {
          type: 'button',
          className: 'dshbl-hover-open',
          title: tr('host.open'),
          onClick: () => requestSessionFocus(sessionId)
        }, tr('hover.open'))
      )
    }

    // ---- 插件 ------------------------------------------------------------
    const plugin = {
      apply(ctx) {
        ensureStyles()
        ctx.on('dispose', () => {
          setOpen(false)
          const styleEl = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')
          if (styleEl) styleEl.remove()
        })
        // RC1 持有语言偏好。较早的宿主不会满足这个可选注入，继续使用浏览器
        // 语言作为回退。
        ctx.inject(['locale'], (scope) => {
          const locale = scope.locale
          if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return
          let releaseDictionary = null
          try { releaseDictionary = locale.register(LOCALE_NS, { zh: ZH, en: EN }) } catch (e) { return }
          const bound = locale.bind(LOCALE_NS)
          const sync = () => setTranslator(bound)
          const unsubscribe = typeof locale.subscribe === 'function' ? locale.subscribe(sync) : null
          sync()
          if (typeof scope.on === 'function') {
            scope.on('dispose', () => {
              if (typeof unsubscribe === 'function') unsubscribe()
              if (typeof releaseDictionary === 'function') releaseDictionary()
              setTranslator(fallbackTranslator(browserFallback))
            })
          }
        })
        // 等待 slot 服务，而不是只探测一次：提供 `slots` 的运行时与本插件的
        // 挂载顺序没有保证，漏掉一次 ctx.get('slots') 会让入口悄悄消失。
        ctx.inject(['slots'], (scope) => {
          // 本插件向启动器菜单贡献一行；当它是页面上最先加载的插件时，还
          // 认领菜单本身（见上方的 utility-launcher 片段）。
          scope.slots.inject(UTILITY_ITEM_SLOT, () => scope.slots.register(
            { name: UTILITY_ITEM_SLOT, id: 'ballast', order: 30,
              label: () => tr('dock.label'), locale: LOCALE_NS },
            () => h(BlMenuItem, null)))
          registerUtilityLauncher(scope)
          scope.slots.inject('shell.overlay', () => scope.slots.register(
            { name: 'shell.overlay', id: 'ballast-panel', order: 80,
              label: () => tr('dock.label'), locale: LOCALE_NS },
            () => h(BallastSurface)))
          // Sidebar 的 Session 行带有本插件的入口：悬停卡片上的一行。
          // 它只在悬停时渲染，也只读事实缓存，因此不增加宿主读取。`order` 30
          // 让它与内置的 schedule 区（10）保持距离。
          scope.slots.inject('sidebar.session.row.hover', () => scope.slots.register(
            { name: 'sidebar.session.row.hover', id: 'ballast', order: 30,
              label: () => tr('dock.label'), locale: LOCALE_NS },
            BallastSessionHover))
        })
      }
    }

    return plugin
  }
})
