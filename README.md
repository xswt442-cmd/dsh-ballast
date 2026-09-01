# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

DSH Web 上下文窗口归因插件，以共享工具坞中的 `ballast` 为入口。它调用 host 侧的 `ctx.tokenMeter.measure()` 按**消息条目**计量窗口占用，把每条消息的路由定价、启发式影子价和正文摘要并列展示，按占用降序标出最该抛掉的那几条。不计算花费，只回答"窗口被谁占了"。

## 功能

- **逐条占用归因**：当前 surface 的每个节点一行，含路由定价 token 与 heuristic 影子 token
- **`Δ` 列**：同一条消息在路由定价与启发式定价下的偏离，偏离最大者为首选压舱物。只有当该节点含图像且所路由的模型声明了图像定价时 `Δ` 才可能非零，详见「度量口径」
- **正文摘要**：抽取三类 surface 事件（`user/message` / `assistant/message` / `tool/result`）；工具结果按 `toolCallId` 回溯出 `[bash]` 这类工具名标记，消息内嵌的工具调用标成 `→ write`；推理块与图像只计数不内联；未知内容块计入 `other`，不做猜测
- **压力来源**：`baseline`（锚点类型与 token 数）、surface 相对锚点的有符号重定价、总占用一并给出
- **会话下拉带标题**：`session/title` → 工作目录名 → sessionId 三级回退，并标出标题来源
- **共享工具坞**：与 dsh-instance-manager、dsh-treekeeper 通过页面内版本化协议共用同一个 Dock，无额外前置插件；单独安装即可自建

## 安装

```powershell
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

安装后重启 DSH Web，点击工具坞中的 ballast 入口打开面板。包发布到 npm 后可改用 `dsh plugin --profile web add dsh-ballast`。

## 工作原理

逐条路由定价只存在于 host：`tokenMeter` 的 `./client` 导出不含 `TokenMeter` / `measure`，浏览器插件无法复现。因此主机端注册同源 API `/dsh-ballast/api`，把结果整形后交给面板。

| 动作 | 方法 | 说明 |
|---|---|---|
| `sessions` | GET | 可计量的 live 会话列表，含 `availability`、标题与标题来源，按事件数降序；默认动作 |
| `measure&sessionId=` | GET | 指定会话的逐条归因；`sessionId` 必需 |

返回形态对齐 `token-meter/src/types.ts`：

```
TokenMeasurement { logRevision, baseline, surfaceDeltaTokens,
                   totalTokens, surfaceTokens, nodes[{seq, tokens, heuristicTokens}] }
row = { seq, tokens, heuristicTokens, priceDelta, routePriced,
        type, time, surfaceOp, preview }   // 后四项来自 session.events[seq]
preview = { kind, text, chars, truncated, blocks,
            images?, reasoning?, injected?, interrupted?, isError?, other? }
```

`nodes[]` 就是当前 surface：被 compaction `replace` 折叠掉的 `append` 不在其中，不会出现仍计价的影子行。

## 度量口径

- `heuristicTokens`：固定密度启发式。文本与推理块 `ceil(length / 4)`，每个内容块加 4 结构开销，每条消息加 4 role framing；图像按 JSON 结构长度计价，不按视觉 token 计价。
- `tokens`：同一节点在**所路由模型**下的定价。路由未声明图像定价、或该节点不含图像时，`tokens` 恒等于 `heuristicTokens`；含图像时改为 `imageFreeTokens + Σ(visualTokens + 该图实际发出的文本按上述启发式计价)`。
- 因此 `Δ = tokens - heuristicTokens` 不是噪声指标：**非零即表示这条消息里有图像被路由按视觉 token 重算过**；`Δ` 为 0 不能区分「无图像 / 无图像定价」与「两者齐备但价格恰好相同」。纯文本行的 `Δ` 恒为 0，与会话是否走过真实路由无关。
- `baseline.kind`：`none`（尚无锚点，`tokens: 0`）/ `estimated` / `usage`（provider 回报的真实用量锚点）。
- `surfaceTokens` = 各节点 `tokens` 之和；`totalTokens` 是含请求与响应的当前压力，非负；`surfaceDeltaTokens` 是 surface 相对 baseline 锚点的有符号重定价。
- `logRevision` = 已消化的 durable 事件数，等于下一个未读 seq。

## 兼容性

| 项 | 要求 / 行为 |
|---|---|
| DSH | `>=0.1.2-alpha.2`（`package.json` 的 `dshhub.compatibility.dsh`，对 `dsh-v0.1.2-alpha.2` 源码验证） |
| Node | `>=20`（`engines.node`） |
| `heuristicTokens` / `Δ` | 需 `>=0.1.2-alpha.2`。`0.1.1-rc.2`（npm `latest`）上其余功能正常，`Δ` 列为空、汇总条标「无影子价」 |
| `shadowPricing` | `available` / `partial` / `absent` / `unknown`，由返回数据推导，不做版本嗅探；空 surface 只能是 `unknown` |

## 失败语义

`measure` 返回三种失败码，另有两种请求级错误；面板把「计量服务是否就绪」与「本次计量是否失败」分开显示。

| code | HTTP | 含义 |
|---|---|---|
| `unavailable` | 503 | `tokenMeter` / `sessions` 尚未注入完成 |
| `no_live_session` | 404 | 会话不 live（已结束或属于另一个 host） |
| `measure_failed` | 500 | `measure()` 自身抛出（日志损坏、step 事件不匹配等），只影响该会话 |
| `session_required` | 400 | `measure` 缺少 `sessionId` |
| `bad_action` | 400 | 不识别的 `action` |

页脚的可用性标签为三态：`计量就绪` / `tokenMeter 未就绪` / `检测中`。

## 安全模型

API 只面向本机面板，所有请求经统一守卫：

- Fetch Metadata：`sec-fetch-site` 非 same-origin / none → 403
- `Origin` 非本实例回环同源 → 403
- `Host` 非回环名 → 403（同时封 DNS rebinding）
- 全部为只读动作；不写入任何状态，不改变会话、不触发压缩

**守卫范围**：三条检查覆盖远程页面、跨站请求与 DNS rebinding，不覆盖本机进程 —— 无请求头的本机调用按同源放行（与 dsh-instance-manager / dsh-treekeeper 一致）。即**本机上能连到该端口的进程可读会话标题与正文摘要**。宿主鉴权（签名 cookie）未作为 ctx 服务暴露给插件，无法复用。已在本地运行的恶意进程不在威胁模型内。

## 边界

- 只读 live 会话：`ctx.sessions` 不回答已结束或属于另一 host 的会话，此类会话不可计量。
- 不做预算、不报价目表、不预测压缩触发（压缩归 DSH 自身）。
- 标题是尽力而为的显示：`session/title` 由 session-title 插件写入，未启用时回落到工作目录名。
- `preview` 面向人眼，截断并标注原始长度；不作为可逆的正文导出。

## 开发与部署

- 运行中的实例**不要**以符号链接挂载本仓库：文件变动触发 HMR 热重载，多文件编辑的中间态可能拖垮实例。
- `npm test` 为 `node --test`，无依赖安装。CI 见 `.github/workflows/compat.yml`：静态检查 + Windows 真机 boot-check，按 `@alpha` / `@latest` 两条版本线各跑一次。
- 发布：改 `package.json` 与 `lib/shared.js` 的 `VERSION`，用 `git tag -a vX.Y.Z -m '<说明>'` 打注解 tag 推上去。`publish.yml` 校验 tag 与版本一致后 `npm publish --provenance`（npm Trusted Publishing / OIDC，仓库不设 token secret），并把 tag 的说明写成 GitHub release。

## 结构

```
package.json       npm 元数据与 dsh.bundle / dsh.client 声明
cordis.patch.yml   向 profile 插入 loader 行
lib/index.js       host：同源 API 与错误语义
lib/meter.js       host：tokenMeter 注入栅栏、会话标题、结果整形
lib/preview.js     host：按事件类型抽取正文摘要
lib/shared.js      host 纯函数（守卫 / 响应 / 参数校验）
lib/dock.js        共享 Dock 的 canonical 副本（classic script）
lib/client.js      client：工具坞入口 + 面板（内嵌 dock.js）
test/              node:test 单元测试与 HTTP 集成测试（npm test）
.github/workflows/ compat.yml（静态检查 + Windows 真机 boot-check）、publish.yml（tag 驱动发布）
```

## License

[MIT](./LICENSE)
