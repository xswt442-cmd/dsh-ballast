# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A DSH Web context-window attribution plugin, entered from `ballast` in the shared utility dock. It calls the host-side `ctx.tokenMeter.measure()` to meter window occupancy **per message entry**, showing each message's route price, its fixed-heuristic shadow price, and a content preview side by side, ordered heaviest first to point at the entries worth dropping. It computes no spend; it answers who is occupying the window.

## Features

- **Per-entry attribution**: one row per current surface node, with route-priced tokens and heuristic shadow tokens.
- **`Δ` column**: the deviation between route pricing and heuristic pricing for the same message; the largest deviations are the first candidates for ballast. `Δ` can only be non-zero when the node carries images and the routed model declares image pricing — see Measurement semantics.
- **Content preview**: extracts the three surface event types (`user/message` / `assistant/message` / `tool/result`). A tool result resolves its `toolCallId` back to the tool name and reads `[bash]`, while tool calls nested in a message read `→ write`. Reasoning blocks and images are counted, never inlined; unrecognized content blocks are counted as `other` rather than guessed at.
- **Pressure source**: `baseline` (anchor kind and tokens), the signed repricing of the surface relative to that anchor, and total occupancy.
- **Titled session dropdown**: falls back `session/title` → workspace basename → sessionId, and reports which source produced the title.
- **Shared utility dock**: the same dock as dsh-instance-manager and dsh-treekeeper through a versioned page-local protocol; no prerequisite plugin, and it self-bootstraps when installed alone.

## Install

```powershell
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

Restart DSH Web, then open the panel from the ballast entry in the dock. Once the package is on npm: `dsh plugin --profile web add dsh-ballast`.

## How it works

Per-node route pricing exists only in `tokenMeter`: its `./client` export carries neither `TokenMeter` nor `measure`, so a browser plugin cannot reproduce it. The host therefore registers the same-origin API `/dsh-ballast/api` and shapes the result for the panel.

| Action | Method | Description |
|---|---|---|
| `sessions` | GET | Live sessions usable for measurement, with `availability`, title and title source; newest-by-event-count first; default action |
| `measure&sessionId=` | GET | Per-entry attribution for one session; `sessionId` required |

The payload mirrors `token-meter/src/types.ts`:

```
TokenMeasurement { logRevision, baseline, surfaceDeltaTokens,
                   totalTokens, surfaceTokens, nodes[{seq, tokens, heuristicTokens}] }
row = { seq, tokens, heuristicTokens, priceDelta, routePriced,
        type, time, surfaceOp, preview }   // last four joined from session.events[seq]
preview = { kind, text, chars, truncated, blocks,
            images?, reasoning?, injected?, interrupted?, isError?, other? }
```

`nodes[]` *is* the current surface: an `append` later folded away by a compaction `replace` is simply absent, so there are no shadow rows that still carry a price.

## Measurement semantics

- `heuristicTokens`: the fixed density heuristic — `ceil(length / 4)` for text and reasoning blocks, plus 4 structural overhead per content block and 4 role framing per message. Images are priced by JSON structural length, not by visual tokens.
- `tokens`: the same node priced under **the routed model**. When the route declares no image pricing, or the node carries no images, `tokens` equals `heuristicTokens` exactly. Otherwise it becomes `imageFreeTokens + Σ(visualTokens + the text the route actually sends for that image, priced by the same heuristic)`.
- Therefore `Δ = tokens - heuristicTokens` is not a noise metric: **non-zero means an image in that message was repriced as visual tokens by the route**. Zero does not discriminate between "no images", "no image pricing" and "both present but equal in price". On a text-only row `Δ` is always 0, independent of whether the session went through real routing.
- `baseline.kind`: `none` (no anchor yet, `tokens: 0`) / `estimated` / `usage` (a real provider-reported anchor).
- `surfaceTokens` is the sum of node `tokens`; `totalTokens` is current request-and-response pressure and non-negative; `surfaceDeltaTokens` is the signed repricing of the surface against the baseline anchor.
- `logRevision` is the number of durable events consumed, equal to the next unread seq.

## Compatibility

| Item | Requirement / behavior |
|---|---|
| DSH | `>=0.1.2-alpha.2` (`dshhub.compatibility.dsh` in `package.json`, verified against the `dsh-v0.1.2-alpha.2` sources) |
| Node | `>=20` (`engines.node`) |
| `heuristicTokens` / `Δ` | Requires `>=0.1.2-alpha.2`. On `0.1.1-rc.2` (npm `latest`) everything else works; the `Δ` column is empty and the totals bar reads "无影子价" (no shadow price) |
| `shadowPricing` | `available` / `partial` / `absent` / `unknown`, derived from the returned payload rather than from version sniffing; an empty surface can only be `unknown` |

## Failure semantics

`measure` returns three failure codes; two more are request-level errors. The panel shows "is the metering service ready" separately from "did this measurement fail".

| code | HTTP | Meaning |
|---|---|---|
| `unavailable` | 503 | `tokenMeter` / `sessions` not yet injected |
| `no_live_session` | 404 | Session not live (ended, or owned by another host) |
| `measure_failed` | 500 | `measure()` threw (corrupt log, mismatched step events, …); affects only that session |
| `session_required` | 400 | `measure` called without `sessionId` |
| `bad_action` | 400 | Unrecognized `action` |

The footer availability label is tri-state: ready / `tokenMeter` not ready / detecting.

## Security model

The API is meant for the local panel only; every request passes one guard:

- Fetch Metadata: `sec-fetch-site` other than same-origin / none → 403
- `Origin` not this instance's loopback origin → 403
- `Host` not a loopback name → 403 (also closes DNS rebinding)
- All actions are read-only; nothing is written, no session is modified, no compaction is triggered

**Guard scope**: the three checks cover remote pages, cross-site requests and DNS rebinding. They do not cover local processes — headerless local callers pass as same-origin (the same posture as dsh-instance-manager and dsh-treekeeper). Any local process able to reach the port can therefore read session titles and content previews. Host authentication (the signed cookie) is not exposed to plugins as a ctx service, so it cannot be reused. A process already running locally is out of the threat model.

## Limits

- Live sessions only: `ctx.sessions` does not answer for ended sessions or sessions owned by another host, so those cannot be measured.
- No budgets, no price tables, no compaction prediction (compaction belongs to DSH itself).
- Titles are best-effort display strings: `session/title` is written by the session-title plugin, and the fallback is the workspace basename.
- `preview` is for human reading: it truncates and reports the original length, and is not a lossless body export.

## Development and deployment

- Do not mount this repository into a running instance through a symlink: file changes trigger HMR, and the intermediate state of a multi-file edit can take the instance down.
- `npm test` runs `node --test` with no dependency install. CI is `.github/workflows/compat.yml`: static checks plus a real Windows boot-check, run once per DSH version line (`@alpha` / `@latest`).
- Release: bump `package.json` and `VERSION` in `lib/shared.js`, then push an annotated tag (`git tag -a vX.Y.Z -m '<notes>'`). `publish.yml` verifies the tag, runs `npm publish --provenance` (npm Trusted Publishing / OIDC, no token secret in the repository), and turns the tag message into the GitHub release.

## Layout

```
package.json       npm metadata with dsh.bundle / dsh.client declarations
cordis.patch.yml   inserts the loader line into the profile
lib/index.js       host: same-origin API and error semantics
lib/meter.js       host: tokenMeter inject fence, session titles, shaping
lib/preview.js     host: per-event-type content previews
lib/shared.js      host pure functions (guard / response / argument checks)
lib/dock.js        canonical copy of the shared Dock (classic script)
lib/client.js      client: dock entry + panel (embeds dock.js)
test/              node:test unit and HTTP integration tests (npm test)
.github/workflows/ compat.yml (static + Windows boot-check), publish.yml (tag-driven)
```

## License

[MIT](./LICENSE)
