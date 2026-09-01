# dsh-ballast

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

DSH Web 上下文窗口归因插件，设置共享工具坞作为入口。本插件使用 host 侧的 `ctx.tokenMeter.measure()` 按**消息条目**计量窗口占用，把每条消息的路由定价、启发式影子价和正文摘要并列展示，并按占用降序标出最该抛掉的那几条，找出"窗口被谁占了"。

## 功能

- **逐条占用归因**：每个 surface 节点一行，含路由定价 token 与 heuristic 影子 token
- **`Δ` 列**：路由定价与 heuristic 的偏离，偏离最大者为首选压舱物。两个前提：host 需提供影子价（`0.1.2-alpha.2` 起，否则面板标「无影子价」）；且该会话走过真实路由——未配置模型路由时 token-meter 回落到 heuristic，`Δ` 接近 0 是预期而非故障
- **正文摘要**：按事件类型抽取（用户提问 / 助手回复 / 工具结果），带 `[bash] exit 0`、`→ write` 等动作标记与图片、推理计数
- **压力来源**：baseline、surface delta、总占用一并给出
- **会话下拉带标题**：`session/title` → 工作目录名 → sessionId 三级回退，不再只有一串裸 id

## 安装

```powershell
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

安装后重启 DSH Web，点击工具坞中的 ballast 入口打开面板。包发布到 npm 后可改用 `dsh plugin --profile web add dsh-ballast`。

## 工作原理

计量必须在宿主侧完成：`tokenMeter` 的逐条路由定价只存在于 host，浏览器插件拿不到。因此主机端注册同源 API `/dsh-ballast/api`，把结果整形后交给面板。

| 动作 | 方法 | 说明 |
|---|---|---|
| `sessions` | GET | 可计量的 live 会话列表，含 `availability`、标题与标题来源；默认动作 |
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

## 失败语义

`measure` 区分四种失败，面板据此显示三态而不是一个笼统的错误。

| code | HTTP | 含义 |
|---|---|---|
| `unavailable` | 503 | `tokenMeter` / `sessions` 尚未注入完成 |
| `no_live_session` | 404 | 会话不 live（已结束或属于另一个 host） |
| `measure_failed` | 500 | `measure()` 自身抛出（日志损坏等），只影响该会话 |
| `session_required` | 400 | `measure` 缺少 `sessionId` |
| `bad_action` | 400 | 不识别的 `action` |

## 安全模型

API 只面向本机面板，所有请求经统一守卫：

- Fetch Metadata：`sec-fetch-site` 非 same-origin / none → 403
- `Origin` 非本实例回环同源 → 403
- `Host` 非回环名 → 403（同时封 DNS rebinding）
- 只读接口，不写入任何状态；不改变会话、不触发压缩

## 结构

```
package.json       npm 元数据与 dsh.bundle / dsh.client 声明
cordis.patch.yml   向 profile 插入 loader 行
CHANGELOG.md       发布说明来源，publish.yml 按版本小节切出 release notes
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
