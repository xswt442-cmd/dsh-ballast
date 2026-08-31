# dsh-ballast

> 不看花了多少钱，看窗口被谁占了。

DSH 上下文压舱物归因面板。按**消息条目**计量上下文窗口占用，标出最占坑的那几条——抛压舱物之前，先知道压舱物是什么。

数据来自 DSH 的 `ctx.tokenMeter.measure()`：**host-only** 的逐条路由定价（`packages/llm/token-meter` 的 `./client` 导出仅含类型，DOM 插件拿不到）。官方 `contextBreakdown` 投影刻意只保留 3 个 O(1) 数字，生态里 348 个 token 类插件全部在"算钱"或读那 3 个数字；逐条 × 窗口占用是空白区（awesome-dsh-plugin 2742 条中 0 命中，2026-08-31 核验）。

## 能回答的问题

- 当前窗口里，**哪条消息**占了多少 token（路由定价 + heuristic 影子价并列）？
- 那条到底是什么：每行带一个按类型抽取的**正文摘要**（用户提问 / 助手回复 / 工具结果，含 `[bash] exit 0`、`→ write`、图片与推理计数）。
- 哪些行是**路由定价明显偏离 heuristic** 的（`Δ` 列）——偏离最大的就是首选压舱物。
- 上下文压力从哪来：baseline 是什么、surface delta 多少？
- 该砍哪几条？（面板按占用降序排列，会话按下拉里的**标题**选，不是裸 sessionId）

## 边界

- 不算钱、不报价目表（那是 `dsh-token-ledger-pro` 等 203 个插件的事）
- 不预测压缩（compaction 触发归 DSH 自身）
- 猜不到非 live 会话（`ctx.sessions.get` 只返回 live session，404 是预期行为）
- 摘要只引用可见正文：`reasoning` 块计入数量但不落字；未知 content block 类型计数后跳过（default-deny），新类型只会让那一行摘要变薄，不会让路由 500

## 接口

Host 半部在 webserver 上挂一个同源守卫的 JSON 路由（dsh-instance-manager 模式）：

```
GET /dsh-ballast/api?action=sessions   可计量的 live 会话列表
GET /dsh-ballast/api?action=measure    逐条归因（&sessionId=...，必需）
```

度量形态（对齐 `token-meter/src/types.ts`）：

```
TokenMeasurement { logRevision, baseline, surfaceDeltaTokens,
                   totalTokens, surfaceTokens, nodes[{seq, tokens, heuristicTokens}] }
row = { seq, tokens, heuristicTokens, priceDelta, routePriced,
        type, time, surfaceOp, preview }   // 后四项来自 session.events[seq]
```

`measure` 把四种失败分得很清楚，面板据此显示三态而不是一个笼统的错误：

| code | HTTP | 含义 |
|---|---|---|
| `unavailable` | 503 | `tokenMeter` / `sessions` 还没注入完成 |
| `no_live_session` | 404 | 会话不 live（已结束或属于另一个 host） |
| `measure_failed` | 500 | `measure()` 自己抛了（日志损坏等）——只坏这一个会话 |
| `session_required` | 400 | `measure` 少了 `sessionId` |
| `bad_action` | 400 | 不认识这个 `action` |

## 兼容

| 项 | 要求 |
|---|---|
| DSH | `>=0.1.2-alpha.2`（对 `dsh-v0.1.2-alpha.2` 源码验证） |
| Node | `>=20` |
| 共享 Dock | 加入或自建 `window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__`：已存在就加入，没有就自己造一个。**单独安装即可用**，不要求 dsh-instance-manager / dsh-treekeeper 在场 |

## 共享 Dock

`lib/dock.js` 是 createhelper 三个插件共用的 dock 引导的 **canonical 副本**。DSH 在 serve 时
不跑打包器（`exports["./client"]` 原样读出一个 classic script），所以它不是运行时 import，
而是被逐行内嵌进 `lib/client.js`；`test/dock-parity.test.js` 断言两边字节一致，改一侧忘改
另一侧会让测试挂掉。这样 dock 仍然是页面内的约定：没有 npm 包，也没有插件需要前置依赖。

改 dock 行为时：改 `lib/dock.js` → 重新内嵌 → 三仓各 `cp` 一份（DIM / DTK 的适配补丁在
`testplace/dock-patches/`，同样仓库外）。

## 开发

```sh
npm test          # node --test
```

CI 见 `.github/workflows/compat.yml`：语法检查、插件形态检查、单测、`npm pack --dry-run`、
清单一致性，以及 Windows 真 DSH boot-check——同源守卫回归，加上通过 harness 自己的
`POST /api/session.create` 造一个 live 会话，把 `measure` 的**正路径**和整条返回契约跑一遍。

设计文档：`testplace/dsh-ballast-project.md`（仓库外）。

## License

MIT
