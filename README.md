# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-ballast)](https://www.npmjs.com/package/dsh-ballast)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

DSH Web 上下文窗口归因插件。它按消息条目显示当前 surface 的 token 占用和正文摘要，帮助定位窗口由哪些条目占用。插件只读，不估算费用、不修改会话，也不触发 compaction。

## 功能

- 按 token 占用列出用户消息、助手消息和工具结果；正文折叠空白后截断，工具结果显示工具名，推理块和图像只计数不内联原文。
- 显示当前路由价格，并在 host 同时提供 heuristic 影子价时标出价差。价差只表示图像可能经过视觉 token 重定价，不表示异常或内容重要性。
- 显示按消息类型聚合的 token 占比，以及当前 host 上各 live session 中最重的条目。
- 在 DSH 0.1.2-rc.1 上显示 provider usage、下一次请求的窗口压力，以及 system/tools/messages 的估算构成；这些构成值与 provider 锚定值口径不同，不强行求和。
- 列出当前 host 的 live session，并从 Mini Utility Dock 打开面板；标题缺失时回退到工作区目录名和 session ID。
- 面板、Dock 和可访问名称跟随 DSH 的全局语言设置；旧 host 回退到浏览器语言。

## 安装

```powershell
# 从 npm 安装并注册到 web profile（推荐）
dsh plugin --profile web add dsh-ballast

# 仅下载 npm package
npm install dsh-ballast

# 或从 GitHub 安装
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

`npm install` 只下载 package，不会启用 DSH profile；在 DSH 中使用仍需将 bundle 加入 profile。安装后重启 DSH Web，并从 Mini Utility Dock 打开 `ballast`。

## 使用

面板提供两个视图：

- **当前会话**：按条目查看当前 surface 的占用、类型、时间和摘要。列表只包含当前 surface；已被 compaction `replace` 折叠的旧 `append` 不再显示。
- **跨会话 Top**：按需为当前 host 的每个 live session 计量一次，并按最重条目排序。会话数越多，读取成本越高；单个会话失败不会阻断其他结果。

面板通过同源只读接口 `/dsh-ballast/api` 获取数据：`sessions` 列出会话，`measure&sessionId=` 计量一个会话，`top&limit=` 返回跨会话结果。接口只接受 `GET` 和 `HEAD`；未提供可解析 token 价格的条目显示为未计价，不参与占用条或 token 占比。

## 边界与安全

- 仅计量当前 host 的 live session，不读取已结束会话或其他 host 的会话。
- 所有操作只读：不写状态、不删除消息、不触发 compaction，也不提供预算、费用表、压缩预测或正文导出。
- 在 DSH 0.1.2-rc.1 及更高版本中，API 复用 Connection 的 Host/Origin 校验和浏览器签名 cookie；缺少或错误的浏览器认证返回 `401/403`。旧 host 才回退到按 TCP 对端、Fetch Metadata、`Origin` 和 loopback `Host` 判定的本地守卫。写方法统一返回 `405`。
- 在旧 host 的兼容模式下，能连接 DSH Web 端口的本机进程仍在信任边界内；RC1+ 则要求有效的 DSH 浏览器会话。
- DSH 未注入 token meter、会话已结束或单次计量失败时返回明确错误；旧 host 缺少影子价时隐藏价差信息，但基础计量仍可用。

## 平台与兼容性

| 项目 | 要求 |
| --- | --- |
| DSH | `>=0.1.2-alpha.2` |
| Node.js | `>=20` |

能力根据 host 返回的数据判断，不根据版本字符串猜测。RC1 的 `seq/eventAt()/snapshotEvents()` 与旧 `.events` 形状均受支持；projection 缺失时只隐藏增强总览，不影响逐消息 token meter。

## 开发与验证

不要把开发仓库以符号链接挂入正在运行的 DSH profile；多文件编辑期间的 HMR 中间态可能使实例退出。修改后运行：

```powershell
npm test
npm run docs:check
Get-ChildItem lib/*.js | ForEach-Object { node --check $_.FullName }
npm pack --dry-run
```

## License

[MIT](./LICENSE)
