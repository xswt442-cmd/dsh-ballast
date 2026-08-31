# Changelog

## 0.1.0 (2026-08-31)

骨架版（skeleton）：

- host 半部：`/dsh-ballast/api` 只读路由（`sessions` / `measure`），同源守卫（Fetch Metadata + Origin + loopback Host），`ctx.inject` 围栏绑定 `tokenMeter` + `sessions`。
- client 半部：加入共享 utility dock，会话下拉 + 占用条形列表（降序）+ 汇总行。
- 单测：守卫、行塑形（降序/事件回查/缺事件容忍）、插件形态、清单一致性。
