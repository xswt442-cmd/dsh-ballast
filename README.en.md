# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A DSH Web context-window attribution plugin. It shows token occupancy and content previews for each message on the current surface, exposing what is filling the window. The plugin is read-only: it does not estimate spend, modify sessions, or trigger compaction.

## Features

- **Per-entry attribution**: sorts the current surface by token occupancy and displays user messages, assistant messages, and tool results.
- **Content previews**: resolves tool names for results, counts reasoning and images without inlining them, and reports the original length of truncated text.
- **Route-price difference**: shows route pricing beside a heuristic shadow price; `Δ` only describes images repriced as visual tokens.
- **Session selection**: lists live sessions on the current host, with titles falling back to the workspace basename and then the session ID.
- **Utility Dock**: Use the dock in the bottom-left corner of the Session settings as the entry point.

## Install

```powershell
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

Restart DSH Web, then open `ballast` from the shared Dock.

## How it works

Per-entry route pricing exists only on the host. The plugin binds services inside `ctx.inject(['tokenMeter', 'sessions'])` and exposes the result to its panel through the same-origin API `/dsh-ballast/api`.

| Action | Method | Description |
|---|---|---|
| `sessions` | GET | Returns measurable live sessions, titles, and service availability; the default action |
| `measure&sessionId=` | GET | Calls `tokenMeter.measure()` and returns per-entry measurement for one session |

Main fields:

| Field | Meaning |
|---|---|
| `tokens` | Token price of the entry under the current routed model |
| `heuristicTokens` | Fixed-density heuristic shadow price |
| `priceDelta` | `tokens - heuristicTokens`; non-zero means an image was repriced as visual tokens |
| `surfaceTokens` | Sum of `tokens` across the current surface |
| `baseline` | `none`, `estimated`, or a provider usage anchor |
| `totalTokens` | Total current request-and-response context pressure |

The list contains the current surface only. An old `append` folded away by a compaction `replace` is no longer shown. Without images, or when the route declares no image pricing, `tokens` equals `heuristicTokens`. `Δ` is therefore neither an anomaly score nor a measure of content importance.

## Security model

- Every action is read-only: no state writes, message deletion, or compaction.
- The API validates Fetch Metadata, `Origin`, and loopback `Host`, rejecting cross-site requests and DNS rebinding.
- Local processes remain inside the trust boundary: a process that can reach the DSH Web port can read session titles and truncated content previews.
- Unavailable services, ended sessions, and per-session measurement failures return distinct errors without affecting other sessions.

## Platform and limits

| Item | Requirement / behavior |
|---|---|
| DSH | `>=0.1.2-alpha.2` |
| Node.js | `>=20` |
| Older token meter | Basic measurement remains available; the shadow price and `Δ` are hidden when `heuristicTokens` is absent |

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
