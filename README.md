# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

[![ci](https://github.com/xswt442-cmd/dsh-ballast/actions/workflows/compat.yml/badge.svg?branch=main)](https://github.com/xswt442-cmd/dsh-ballast/actions/workflows/compat.yml)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=plugin&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-ballast?label=npm&color=4d6bfe)](https://www.npmjs.com/package/dsh-ballast)
[![release](https://img.shields.io/github/v/release/xswt442-cmd/dsh-ballast?label=release&color=16a3a3)](https://github.com/xswt442-cmd/dsh-ballast/releases)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=%3E%3D0.1.5-rc.3&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/static/v1?label=node&message=%3E%3D20&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/d18m/dsh-ballast?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-ballast)
[![license](https://img.shields.io/badge/license-MIT-22c55e.svg)](./LICENSE)

DSH Web 上下文窗口归因插件。它按消息条目显示当前 surface 的 token 占用和正文摘要，定位窗口由哪些条目占用。DSH 内置的上下文显示给出整段占比；逐条归因、最重条目与跨 live session 比较由本插件提供。插件只读，不估算费用、不修改会话，也不触发 compaction。

## 功能

- 按 token 占用列出用户消息、助手消息和工具结果。正文折叠空白后截断，工具结果显示工具名，推理块和图像只计数不内联原文。
- 显示当前路由价格，host 同时提供 heuristic 影子价时标出价差。价差表示图像可能经过视觉 token 重定价，不表示异常或内容重要性。
- 显示按消息类型聚合的 token 占比，以及当前 host 上各 live session 中最重的条目。
- 显示 provider usage、下一次请求的窗口压力，以及 system/tools/messages 的估算构成。估算构成与 provider usage 锚点口径不同，面板不把两者相加。
- 列出当前 host 的会话：进程内活着的，以及已存储但没有 live agent 的。会话标题缺失时显示工作区目录名与 session ID。
- 面板头部标出应答的宿主进程（PID 与端口），会话计数只统计该进程内的会话。
- 侧栏每个会话行的悬浮卡片有一行入口，点击后打开该会话的面板。
- 该行显示插件已取到的该会话占用：surface 总量与最重条目，只取到会话列表时显示日志条数。
- 悬停不向宿主请求数据，没有缓存时该行不显示数字。
- 面板、入口图标和可访问名称跟随 DSH 的全局语言设置。host 未提供该设置时使用浏览器语言。

## 安装

```powershell
# 从 npm 安装并注册到 web profile（推荐）
dsh plugin --profile web add dsh-ballast

# 仅下载 npm package
npm install dsh-ballast

# 或从 GitHub 安装
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

`npm install` 只下载 package，在 DSH 中使用仍需把 bundle 加入 web profile。安装后重启 DSH Web，从页面左下的 `dsh-mini-utility-dock` launcher 打开 `ballast`。

## 使用

面板提供两个视图：

- **当前会话**：按条目查看当前 surface 的占用、类型、时间和摘要。已被 compaction `replace` 折叠的旧 `append` 条目不显示。
- **跨会话 Top**：按需为当前 host 的每个 live session 计量一次，并按最重条目排序。读取成本随 live session 数量增加。单个会话计量失败不影响其他会话的结果。该视图同时列出已存储但没有 live agent 的会话，按占盘大小排序，并给出各自投影缓存里的上下文压力。日志条数、字节数与 revision 来自持久化快照，token 数字来自投影缓存，因此可能停留在该会话最后一次写入时的值；标题来自一次批量日志读取。

面板通过同源只读接口 `/dsh-ballast/api` 获取数据：`sessions` 列出会话，`measure&sessionId=` 计量一个会话，`top&limit=` 返回跨会话结果，`cold` 返回已存储但没有 live agent 的会话。接口只接受 `GET` 和 `HEAD`，其他方法返回 `405`。未提供可解析 token 价格的条目显示为未计价，不参与占用条或 token 占比。

## 安全与边界

- 只计量当前 host 的 live session，不读取其他 host 的会话；已结束会话只读持久化快照、投影缓存与一次批量标题读取。
- 所有操作只读，不写状态、不删除消息，也不触发 compaction。
- 不提供预算、费用表、压缩预测与正文导出。
- DSH 0.1.5-rc.3 及更高版本的 API 复用 Connection 的 Host/Origin 校验与浏览器签名 cookie。
- 缺少或错误的浏览器认证返回 `401/403`。
- 未挂载 Connection 的宿主回退到本地守卫，按 TCP 对端、Fetch Metadata、`Origin` 和 loopback `Host` 判定。
- 本地守卫模式下，能连接 DSH Web 端口的本机进程在信任边界内。
- token meter 未注入、会话已结束或单次计量失败时返回明确错误。已结束会话不在 `measure` 的范围内，由 `cold` 列出。
- host 缺少 heuristic 影子价时不显示价差，基础计量仍然提供。
- 日志长度与继承前缀取 `Session.seq` 与 `Session.inheritedEventCount`；按 seq 取事件内容与批量标题走 `ctx.sessionQuery`（`readSession` / `readTitleSnapshots`）。两者都缺席时回落到旧 host 的 `.events` 数组。
- 已废弃的 `Session.eventAt()`、`Session.snapshotEvents()` 与 `Session.ownEvents()` 一次都不调用，由测试直接断言源码文本与行为两条路径。

## 平台与兼容性

| 项目 | 要求 |
| --- | --- |
| DSH | `>=0.1.5-rc.3` |
| Node.js | `>=20` |

RC1 的 `seq`、`inheritedEventCount`、`events` 均受支持：有 `ctx.sessionQuery` 时按 seq 取事件内容，没有时用旧的 `.events` 数组。projection 缺失时不显示 provider usage 与构成估算，逐条 token 计量仍然提供。`contextPressure` 缺少 `contextWindow` 时留空，不从别处推断。

## 开发与验证

开发仓库以符号链接挂入正在运行的 DSH profile 时，多文件编辑期间的 HMR 可能载入中间状态并使实例退出。验证命令：

```powershell
npm test
npm run docs:check
Get-ChildItem lib/*.js | ForEach-Object { node --check $_.FullName }
node --input-type=module -e "import('./lib/index.js').then(m => { if (!m.default || typeof m.default.apply !== 'function') process.exit(1) })"
npm pack --dry-run
```

## License

[MIT](./LICENSE)
