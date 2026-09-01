# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-ballast)](https://www.npmjs.com/package/dsh-ballast)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A DSH Web context-window attribution plugin. It shows token occupancy and content previews for each message on the current surface, exposing what is filling the window. The plugin is read-only: it does not estimate spend, modify sessions, or trigger compaction.

## Features

- **Per-entry attribution**: sorts the current surface by token occupancy and displays user messages, assistant messages, and tool results; when the host supplies a parseable timestamp, hovering `#seq` shows when the entry was written.
- **Content previews**: resolves tool names for results, counts reasoning and images without inlining them, and truncates text at 220 code points after whitespace collapsing; `preview.chars` and `preview.truncated` record the pre-truncation length, which a clipped row repeats in its tooltip.
- **Route-price difference**: rows show the route price, and rows whose two prices differ carry a `Δ` badge whose tooltip holds both; the totals bar counts the repriced rows. `Δ` can only come from images repriced as visual tokens.
- **Session selection**: lists live sessions on the current host; a title is the latest `session/title` event, falling back to the workspace basename and then the session ID.
- **Utility Dock**: the entry point is the shared page-level dock, placed next to the sidebar at the bottom-left by default, switchable to bottom-right or hidden, with the choice stored in `localStorage`.

## Install

```powershell
dsh plugin --profile web add dsh-ballast
# or install from Git
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

Restart DSH Web, then open `ballast` from the shared Dock.

## How it works

Per-entry route pricing exists only on the host. The plugin binds services inside `ctx.inject(['tokenMeter', 'sessions'])` and exposes the result to its panel through the same-origin API `/dsh-ballast/api`.

| Action | Method | Description |
|---|---|---|
| `sessions` | GET | Returns the live sessions on this host (`sessionId`, `eventCount`, title and title source) plus service availability; the default action |
| `measure&sessionId=` | GET | Calls `tokenMeter.measure()` and returns per-entry measurement for one session |

Main fields:

| Field | Meaning |
|---|---|
| `tokens` | Token price of the entry under the current routed model |
| `heuristicTokens` | Fixed-density heuristic shadow price; `null` on older hosts |
| `priceDelta` | `tokens - heuristicTokens`, or `null` without a shadow price; non-zero implies an image was repriced, not the reverse (a repriced row can still cost the same) |
| `surfaceTokens` | Sum of `tokens` across the current surface |
| `baseline.kind` | `none`, `estimated`, or `usage` (a provider usage anchor); `baseline.tokens` is the anchor value |
| `totalTokens` | Total current request-and-response context pressure |

The list contains the current surface only. An old `append` folded away by a compaction `replace` is no longer shown. Without images, or when the route declares no image pricing, `tokens` equals `heuristicTokens`. `Δ` is therefore neither an anomaly score nor a measure of content importance. With `baseline.kind` set to `none`, the totals bar names the kind without an anchor count: no anchor is not the same statement as an anchor of 0. A payload that matches no known surface message shape is labelled `未识别正文` (unrecognised) rather than empty.

## Security model

- Every action is read-only: no state writes, message deletion, or compaction.
- The API validates Fetch Metadata, `Origin`, and loopback `Host`, rejecting cross-site requests and DNS rebinding.
- Local processes remain inside the trust boundary: a process that can reach the DSH Web port can read session titles, the truncated content previews and their pre-truncation lengths, and the pid, port, and start time in the `sessions` reply.
- Unavailable services, ended sessions, and per-session measurement failures return distinct errors without affecting other sessions.

## Platform and limits

| Item | Requirement / behavior |
|---|---|
| DSH | `>=0.1.2-alpha.2` |
| Node.js | `>=20` |
| Older token meter | Basic measurement remains available; when the shadow price is absent, `Δ` and the spread count are hidden and the totals bar shows `无影子价` (no shadow price) or, for a partially priced surface, `影子价不全` |

- Measures live sessions on the current host only.
- No budgets, price tables, compaction prediction, or lossless content export.
- Capabilities are derived from returned data rather than guessed from version strings.

## Layout

```text
lib/index.js    host entry and same-origin API
lib/meter.js    tokenMeter injection, session titles, result shaping
lib/preview.js  message and tool-result previews
lib/client.js   Dock entry and panel
lib/dock.js     shared Dock protocol implementation
test/           unit and HTTP integration tests
```

Run the tests:

```powershell
npm test
```

Do not symlink the development repository into an active profile: HMR can load an intermediate multi-file edit and terminate the DSH instance.

## License

[MIT](./LICENSE)
