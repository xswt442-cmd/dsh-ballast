# dsh-ballast

> 不看花了多少钱，看窗口被谁占了。

DSH 上下文压舱物归因面板。按**消息条目**计量上下文窗口占用，标出最占坑的那几条——抛压舱物之前，先知道压舱物是什么。

数据来自 DSH 的 `ctx.tokenMeter.measure()`：**host-only** 的逐条路由定价（`packages/llm/token-meter` 的 `./client` 导出仅含类型，DOM 插件拿不到）。官方 `contextBreakdown` 投影刻意只保留 3 个 O(1) 数字，生态里 348 个 token 类插件全部在"算钱"或读那 3 个数字；逐条 × 窗口占用是空白区（awesome-dsh-plugin 2742 条中 0 命中，2026-08-31 核验）。

## 能回答的问题

- 当前窗口里，**哪条消息**占了多少 token（路由定价 + heuristic 影子价并列）？
- 上下文压力从哪来：baseline 是什么、surface delta 多少？
- 该砍哪几条？（面板按占用降序排列）

## 不能回答的问题（M0 边界）

- 不算钱、不报价目表（那是 `dsh-token-ledger-pro` 等 203 个插件的事）
- 不预测压缩（compaction 触发归 DSH 自身）
- 猜不到非 live 会话（`ctx.sessions.get` 只返回 live session，404 是预期行为）

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
row = { seq, tokens, heuristicTokens, type, time }   // type 来自 session.events[seq].type
```

## 兼容

| 项 | 要求 |
|---|---|
| DSH | `>=0.1.2-alpha.2`（对 `dsh-v0.1.2-alpha.2` 源码验证） |
| Node | `>=20` |
| 共享 Dock | 加入 `window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__`（与 dsh-instance-manager、dsh-treekeeper 共存；骨架期仅加入不自举，需至少一个 Dock 拥有者插件在场） |

## 开发

```sh
npm test          # node --test
```

CI 见 `.github/workflows/compat.yml`：语法检查、插件形态检查、单测、`npm pack --dry-run`、清单一致性、Windows 真 DSH boot-check（含同源守卫回归）。

设计文档：`testplace/dsh-ballast-m0.md`（仓库外）。

## License

MIT
