# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-ballast)](https://www.npmjs.com/package/dsh-ballast)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

DSH Web 上下文窗口归因插件。它按消息条目展示当前 surface 的 token 占用和正文摘要，帮助定位“窗口被谁占了”。插件只读，不估算费用，不修改会话，也不触发压缩。

## 功能

- **逐条归因**：按 token 占用降序排列当前 surface，显示用户消息、助手消息和工具结果。
- **正文摘要**：工具结果回溯工具名；推理块与图像只计数，不内联原文；长文本截断并保留原始长度。
- **路由价差**：并列显示路由定价与 heuristic 影子价；`Δ` 仅表示图像被模型按视觉 token 重新定价。
- **会话选择**：列出当前 host 的 live 会话；标题依次回退到工作区目录名和 session ID。
- **工具坞**：Session 左下角设置工具坞作为入口。

## 安装

```powershell
dsh plugin --profile web add dsh-ballast
# 或 Git 直装
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

安装后重启 DSH Web，点击共享 Dock 中的 `ballast`。

## 工作原理

逐条路由定价只存在于 host。插件在 `ctx.inject(['tokenMeter', 'sessions'])` 内绑定服务，通过同源 API `/dsh-ballast/api` 向面板提供结果。

| 动作 | 方法 | 说明 |
|---|---|---|
| `sessions` | GET | 返回可计量的 live 会话、标题和服务可用性；默认动作 |
| `measure&sessionId=` | GET | 调用 `tokenMeter.measure()`，返回指定会话的逐条计量结果 |

主要字段：

| 字段 | 含义 |
|---|---|
| `tokens` | 当前路由模型对该条目的 token 定价 |
| `heuristicTokens` | 固定密度 heuristic 影子价 |
| `priceDelta` | `tokens - heuristicTokens`；非零表示图像发生视觉 token 重定价 |
| `surfaceTokens` | 当前 surface 各条目 `tokens` 之和 |
| `baseline` | `none`、`estimated` 或 provider usage 锚点 |
| `totalTokens` | 当前请求与响应的总上下文压力 |

列表只包含当前 surface。已经被 compaction `replace` 折叠的旧 `append` 不再显示。没有图像或路由未声明图像定价时，`tokens` 与 `heuristicTokens` 相同；因此 `Δ` 不是异常分数，也不代表内容重要性。

## 安全模型

- 所有动作只读，不写状态、不删除消息、不触发压缩。
- API 校验 Fetch Metadata、`Origin` 和回环 `Host`，拒绝跨站请求与 DNS rebinding。
- 本机进程仍在信任边界内：能连接 DSH Web 端口的本机进程可读取会话标题和截断后的正文摘要。
- 服务未注入、会话已结束或单次计量失败时分别返回明确错误，不影响其他会话。

## 平台与边界

| 项目 | 要求 / 行为 |
|---|---|
| DSH | `>=0.1.2-alpha.2` |
| Node.js | `>=20` |
| 旧版 token meter | 基础计量可用；缺少 `heuristicTokens` 时隐藏影子价和 `Δ` |

- 只计量当前 host 的 live 会话，不读取已结束会话或其他 host 的会话。
- 不提供预算、费用表、压缩预测或可逆正文导出。
- 能力根据返回数据判断，不根据版本字符串猜测。

## 结构

```text
lib/index.js    host 入口与同源 API
lib/meter.js    tokenMeter 注入、会话标题与结果整形
lib/preview.js  消息与工具结果摘要
lib/client.js   Dock 入口与面板
lib/dock.js     共享 Dock 协议实现
test/           单元测试与 HTTP 集成测试
```

运行测试：

```powershell
npm test
```

不要把开发仓库以符号链接挂到正在使用的 profile；多文件编辑触发的 HMR 中间态可能使 DSH 实例退出。

## License

[MIT](./LICENSE)
