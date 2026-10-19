# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

[![ci](https://github.com/xswt442-cmd/dsh-ballast/actions/workflows/compat.yml/badge.svg?branch=main)](https://github.com/xswt442-cmd/dsh-ballast/actions/workflows/compat.yml)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=plugin&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-ballast?label=npm&color=4d6bfe)](https://www.npmjs.com/package/dsh-ballast)
[![release](https://img.shields.io/github/v/release/xswt442-cmd/dsh-ballast?label=release&color=16a3a3)](https://github.com/xswt442-cmd/dsh-ballast/releases)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=%3E%3D0.2.0-rc.1&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/static/v1?label=node&message=%3E%3D20&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/d18m/dsh-ballast?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-ballast)
[![license](https://img.shields.io/badge/license-MIT-22c55e.svg)](./LICENSE)

A DSH Web context-window attribution plugin. It shows token occupancy and content previews for each entry on the current surface to identify what fills the window. DSH's built-in context display gives a whole-window share; per-entry attribution, the heaviest entries, and comparison across live sessions come from this plugin. It is read-only and does not estimate spend, modify sessions, or trigger compaction.

## Features

- List user messages, assistant messages, and tool results by token occupancy. Text is whitespace-collapsed and truncated, tool results show their tool name, and reasoning blocks and images are counted but not inlined.
- Every row of the current session carries a locate button: clicking it scrolls the chat to that entry and highlights it. The button appears only while the chat is showing the session being measured.
- Locating works through internal DOM attributes of the chat, which are not a public interface. When the host drops those attributes the button is absent, or clicking it does nothing; the entries are still listed.
- Show the current route price and, when the host also supplies a heuristic shadow price, mark the difference. A difference indicates that an image may have been repriced as visual tokens; it is not an anomaly or an importance score.
- Show token share aggregated by message type and the heaviest entry in each live session on the current host.
- Show provider usage, next-request context pressure, and the estimated system/tools/messages mix. The mix and the provider-usage anchor use different accounting bases, and the panel does not add them together.
- List the sessions on the current host: those live in this process, plus those stored with no live agent. When a session title is missing, the row shows the workspace basename and session ID.
- Stored sessions can be measured on demand from their complete event log, by the same accounting as a live session, instead of showing only the possibly stale figures the projection cache holds.
- The panel header names the host process that answered, by PID and port, and the session count covers only that process's sessions.
- Every Sidebar Session row's hover card carries one ballast line; clicking it opens the panel on that session.
- That line shows the occupancy the plugin has already read for the session: its surface total and heaviest entry, or the log length when only the session list has been read.
- Hovering reads nothing from the host, and with nothing cached the line shows no number.
- The panel, the launcher icon, and accessible labels follow DSH's global language setting. Hosts without that setting use the browser language.

## Install

```powershell
# install from npm and register with the web profile (recommended)
dsh plugin --profile web add dsh-ballast

# download the npm package only
npm install dsh-ballast

# or install from GitHub
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

`npm install` downloads the package only; using the plugin in DSH still requires adding its bundle to a web profile. Restart DSH Web after installation and open `ballast` from the `dsh-mini-utility-dock` launcher at the bottom-left of the work area.

## Usage

The panel has two views:

- **Current session**: inspect occupancy, type, time, and preview for each entry on the current surface. Entries folded away by a compaction `replace` are not shown.
- **Cross-session top**: on demand, measure each live session on the current host once and sort sessions by their heaviest entry. Read cost grows with the number of live sessions. One failed session does not affect the other results. The same view lists stored sessions that no live agent owns, largest on disk first, with the context pressure the projection cache held for each. Event count, size, and revision come from the persistence snapshot and the token figures from the projection cache, so they can be as old as that session's last write; the titles come from one batched log read.
- Every stored row carries a measure action: clicking it reads that session's complete event log, measures it by the same accounting as a live session, and shows its surface total and entry count. Listing the sessions reads no log; only the click does, and that read costs an order of magnitude more than listing a row, so it is per-row and one session at a time. A corrupt log fails on its own row and leaves the others alone.

The panel reads from the same-origin, read-only `/dsh-ballast/api` route: `sessions` lists sessions, `measure&sessionId=` measures one session, `top&limit=` returns cross-session results, `cold` returns the stored sessions that no live agent owns, and `cold-measure&sessionIds=` measures those stored sessions on demand (at most 20 per request). The route accepts `GET` and `HEAD`; other methods return `405`. Rows without a parseable token price are marked unpriced and excluded from occupancy bars and token shares.

## Safety and limits

- Measures live sessions on the current host only; sessions on other hosts are not read, and ended sessions are read only through their persistence snapshot, the projection cache, and one batched title read.
- All operations are read-only: no state writes, no message deletion, and no compaction.
- There are no budgets, price tables, compaction forecasts, or content exports.
- On every supported DSH version (`>=0.2.0-rc.1`), the API reuses Connection's Host/Origin checks and signed browser cookie.
- Missing or invalid browser authentication returns `401/403`.
- A host that does not mount Connection falls back to the local guard, which decides by TCP peer, Fetch Metadata, `Origin`, and loopback `Host`.
- Under the local guard, a process that can reach the DSH Web port is inside the trust boundary.
- A missing token meter, an ended session, and a failed per-session measurement each return an explicit error. An ended session is out of `measure`'s scope and is listed by `cold` instead.
- Measuring a stored session needs `ctx.sessionQuery` and an `@deepseek-ai/dsh-session` resolvable inside the host process. Without either one the row offers no measure action and nothing else changes.
- Stored measurement runs one session at a time and releases that session's log as soon as it is measured. A single request measures at most 20 sessions.
- A host without heuristic shadow prices shows no price difference; basic measurement is still provided.
- The log length and the inherited prefix come from `Session.seq` and `Session.inheritedEventCount`; reading event content by seq and reading titles in bulk go through `ctx.sessionQuery` (`readSession` / `readTitleSnapshots`). When both are absent, the older host's `.events` array is the fallback.
- The deprecated `Session.eventAt()`, `Session.snapshotEvents()`, and `Session.ownEvents()` are not called.

## Platform and compatibility

| Item | Requirement |
| --- | --- |
| DSH | `>=0.2.0-rc.1` |
| Node.js | `>=20` |

DSH Desktop is an Electron shell around the same web application; it shares the `webServer`, the client seats, and the launcher, and its data directory is the same `DSH_HOME`. This plugin behaves on Desktop as it does on `dsh web`. The compatibility matrix pins `0.2.0-rc.1` and `0.2.1-rc.2`; each version boots a real host once on Windows and once on Linux.

The 0.1.x lines below `0.2.0-rc.1` are no longer tested and are no longer claimed as supported. Host behaviour older than that is still covered by the unit tests, but a real boot is only verified against the two declared lines.

RC1's `seq`, `inheritedEventCount`, and `events` are all supported: with `ctx.sessionQuery` present, event content is read by seq, and without it the older `.events` array is used. A missing projection hides the provider-usage and estimated-mix block; per-message token metering is still provided. A `contextPressure` without a `contextWindow` stays empty rather than being inferred from elsewhere.

## Development

Verification commands are in `AGENTS.md` at the repository root; release steps are in `docs/development/RELEASE.md`.

## License

[MIT](./LICENSE)
