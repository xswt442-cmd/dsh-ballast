# 更新日志

Release notes 由对应版本段生成；最新版本在前。
英文版见 [CHANGELOG.en.md](CHANGELOG.en.md)。

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
