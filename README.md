# dsh-ballast

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

DSH Web 上下文窗口归因插件，以共享工具坞中的 `ballast` 为入口。它用 host 侧的 `ctx.tokenMeter.measure()` 按**消息条目**计量窗口占用，把每条消息的路由定价、启发式影子价和正文摘要并列展示，并按占用降序标出最该抛掉的那几条。不计算花费，只回答"窗口被谁占了"。

## 功能

- **逐条占用归因**：每个 surface 节点一行，含路由定价 token 与 heuristic 影子 token
- **`Δ` 列**：路由定价与 heuristic 的偏离，偏离最大者为首选压舱物。两个前提：host 需提供影子价（`0.1.2-alpha.2` 起，否则面板标「无影子价」）；且该会话走过真实路由——未配置模型路由时 token-meter 回落到 heuristic，`Δ` 接近 0 是预期而非故障
- **正文摘要**：按事件类型抽取（用户提问 / 助手回复 / 工具结果），带 `[bash] exit 0`、`→ write` 等动作标记与图片、推理计数
- **压力来源**：baseline、surface delta、总占用一并给出
- **会话下拉带标题**：`session/title` → 工作目录名 → sessionId 三级回退，不再只有一串裸 id
- **共享工具坞**：与 dsh-instance-manager、dsh-treekeeper 复用同一个 Dock；已存在就加入，不存在就自建，**单独安装即可用**

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

行按 `tokens` 降序返回；`type` / `time` / `surfaceOp` / `preview` 取自对应的 surface 事件，`seq` 即事件下标。`text` 截到 220 字，`chars` 是截断前的总字数。

`heuristicTokens` / `priceDelta` / `routePriced` 在**不提供影子价的 host 上为 `null`**（`nodes[].heuristicTokens` 自 `0.1.2-alpha.2` 起才有）。度量层同时给出 `shadowPricing: 'available' | 'partial' | 'absent' | 'unknown'`——从返回数据推导，不做版本嗅探，空 surface 只能是 `unknown`。

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

**边界要说清**：守卫按同源判定放行**无请求头的本机调用**（这是 dsh-instance-manager / dsh-treekeeper 的一致姿态，面板之外的主机侧工具也依赖它）。实测：开启鉴权的 alpha host 上 `POST /api/session.list` 无 cookie 返回 401，而本路由仍返回 200 —— 即**本机上任意进程都能读到会话标题与正文摘要**，比只读端口列表的插件敏感。DSH 目前没把签名 cookie 校验器（`BrowserAuth.isAuthenticated`）作为 ctx 服务暴露给插件，所以复用宿主鉴权暂时做不到；把这三条同源检查当作"挡住远程页面与跨站请求"，不要当作"挡住本机进程"。

## 边界

- 不算钱、不报价目表
- 不预测压缩（compaction 触发归 DSH 自身）
- 只覆盖 live 会话：`ctx.sessions.get` 不返回冷会话，404 是预期行为
- 摘要只引用可见正文：`reasoning` 块计入数量不落字；未知 content block 类型计数后跳过（default-deny），新类型只会让该行摘要变薄，不会让路由 500

## 兼容

| 项 | 要求 |
|---|---|
| DSH | `>=0.1.2-alpha.2`（对 `dsh-v0.1.2-alpha.2` 源码验证） |
| 影子价 / `Δ` | 需 `>=0.1.2-alpha.2`；`0.1.1-rc.2`（npm `latest`）上其余功能正常，`Δ` 列显示「无影子价」 |
| Node | `>=20` |
| 共享 Dock | 加入或自建 `window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__`，协议 `createhelper.dsh.utility-dock` v1；无前置插件 |

## 共享 Dock

`lib/dock.js` 是三个 createhelper 插件共用的 dock 引导的 **canonical 副本**。DSH serve 客户端不跑打包器（`exports["./client"]` 原样读出一个 classic script），所以它是逐行内嵌进 `lib/client.js` 而不是运行时 import；`test/dock-parity.test.js` 断言两侧字节一致。dock 因此仍是页面内的约定：没有 npm 包，也没有插件声明前置依赖。

改 dock 行为时：改 `lib/dock.js` → 重新内嵌 → 三仓各同步一份（DIM / DTK 的适配补丁在 `testplace/dock-patches/`，仓库外）。

## 开发与部署

```sh
npm test          # node --test
```

- CI 见 `.github/workflows/compat.yml`：语法检查、插件形态检查、单测、`npm pack --dry-run`、清单一致性；另有 Windows 真 DSH boot-check，按 `@alpha` / `@latest` 两条版本线各跑一次（同源守卫回归 + 通过 harness 自身的 `POST /api/session.create` 建立 live 会话，把 `measure` 的正路径与整条返回契约跑一遍）
- CI 的 boot-check 没有模型路由，测到的 surface 恒为 0 节点，逐行契约在那里够不着——这部分由 `test/http.test.js` 用真实 socket 与有流量的定价面覆盖，CI 会显式打一条 `::notice::` 说明跳过
- 发布：改 `package.json` + `lib/shared.js` 的 `VERSION` + `CHANGELOG.md`，打 tag 推上去，`.github/workflows/publish.yml` 校验 tag 一致性后 `npm publish --provenance`（npm Trusted Publishing / OIDC，仓库不设 token secret），再用 `CHANGELOG.md` 对应小节建 GitHub release
- 运行中的实例**不要**以符号链接挂载本仓库：文件变动触发 HMR 热重载，多文件编辑的中间态可能拖垮实例
- 本地验证用独立 `DSH_HOME` 与专用 profile，把 checkout 装进去而不是改线上配置：
  `DSH_HOME=<隔离目录> dsh plugin --profile dev add file:E:/.codes/createhelper/dsh-ballast`，
  随后 `DSH_HOME=<同一目录> dsh web --profile dev`。`cordis.patch.yml` 的插件行按包名引用，
  需经 profile 的模块解析才能命中，单用 `dsh web --patch` 指向它不生效
- 真实流量验证同上，但把 `node_modules/dsh-ballast` 做成指向本仓库的 junction，并把 `~/.dsh/sessions` 复制进隔离目录：读的是历史会话，不需要模型 key。**host 侧改动不会被 HMR 重载**，改完 `lib/index.js`、`lib/meter.js` 必须重启实例才生效
- 设计文档与里程碑记录在 `testplace/`（仓库外）

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
