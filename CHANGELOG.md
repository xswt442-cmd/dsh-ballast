# 更新日志

Release notes 由对应版本段生成；最新版本在前。
英文版见 [CHANGELOG.en.md](CHANGELOG.en.md)。

## Unreleased

### 修复

- 请求守卫改用 TCP 对端地址判定本地性：非回环来源一律 403。此前伪造 `Host: 127.0.0.1` 即可通过守卫，而 DSH 支持监听 `0.0.0.0`。
- 服务运行在 HTTP 默认端口 80 时，省略端口的同源 Origin（如 `http://127.0.0.1`）不再被误判为跨源。
- 面板刷新整段流程使用同一 generation 戳：列表请求在途时的选择或视图切换不会被过期响应覆盖。
- measure/top 请求失败（DSH 重启、HMR 断连、网络异常）现在落为面板内错误提示，不再产生未处理的 Promise 拒绝。
- 面板刷新按钮的加载态归属当前刷新：关闭再打开面板时，上一轮刷新的迟到响应不会提前把按钮恢复成可用。
- 面板卸载（HMR 或插件停用）后使在途请求失效，不再让它们继续持有该组件的 setState。
- Dock 项 `label` 缺失或为空白时回退为 `id`，不再渲染出 `aria-label="undefined"`。

## 0.2.5 - 2026-09-03

### 变更

- Host 清理改用 Cordis effect 生命周期；兼容 CI 覆盖 Windows 与 Ubuntu 的 DSH latest/alpha。

### 修复

- 收紧本地 HTTP 守卫：只接受精确回环主机、匹配当前 Web 端口的 Origin，并正确支持 IPv6 `[::1]`。

## 0.2.4 - 2026-09-02

### 变更

- Mini Utility Dock 改由 `dsh-mini-utility-dock` 在构建时同步，协议测试归入公共包。

### 修复

- 兼容 DSH alpha 中事件日志尚未初始化的新建会话，避免会话列表接口返回 500。

## 0.2.3 - 2026-09-02

### 变更

- 精简并对齐双语 README、仓库指南、发布说明与 package 元数据。
- 增加双语文档漂移检查、版本锁步测试和基于 changelog 的幂等发布流程。

## 0.2.2 - 2026-09-01

### 新增

- 增加类型聚合、跨会话 Top、快照年龄与 log 修订 memo。
- Mini Utility Dock 图标增加安全过滤。

### 修复

- 只读 API 严格限制为 GET/HEAD；缺失路由价不再伪造价差。
- 延迟测量结果不会覆盖用户后来选择的会话。

## 0.2.1 - 2026-09-01

### 变更

- npm 发布使用包名与 Trusted Publishing；发布检查与 GitHub Release 可独立重试。

## 0.2.0 - 2026-08-31

### 新增

- 首次发布 M1：提供逐消息 token 归因、正文摘要、路由价差与会话选择面板。
