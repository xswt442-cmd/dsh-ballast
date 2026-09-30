# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

[![ci](https://github.com/xswt442-cmd/dsh-ballast/actions/workflows/compat.yml/badge.svg?branch=main)](https://github.com/xswt442-cmd/dsh-ballast/actions/workflows/compat.yml)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=plugin&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-ballast?label=npm&color=4d6bfe)](https://www.npmjs.com/package/dsh-ballast)
[![release](https://img.shields.io/github/v/release/xswt442-cmd/dsh-ballast?label=release&color=16a3a3)](https://github.com/xswt442-cmd/dsh-ballast/releases)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=%3E%3D0.1.5-rc.3&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/static/v1?label=node&message=%3E%3D20&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/d18m/dsh-ballast?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-ballast)
[![license](https://img.shields.io/badge/license-MIT-22c55e.svg)](./LICENSE)

A DSH Web context-window attribution plugin. It shows token occupancy and content previews for each entry on the current surface to identify what fills the window. DSH's built-in context display gives a whole-window share; per-entry attribution, the heaviest entries, and comparison across live sessions come from this plugin. It is read-only and does not estimate spend, modify sessions, or trigger compaction.

## Features

- List user messages, assistant messages, and tool results by token occupancy. Text is whitespace-collapsed and truncated, tool results show their tool name, and reasoning blocks and images are counted but not inlined.
- Show the current route price and, when the host also supplies a heuristic shadow price, mark the difference. A difference indicates that an image may have been repriced as visual tokens; it is not an anomaly or an importance score.
- Show token share aggregated by message type and the heaviest entry in each live session on the current host.
- Show provider usage, next-request context pressure, and the estimated system/tools/messages mix. The mix and the provider-usage anchor use different accounting bases, and the panel does not add them together.
- List the sessions on the current host: those live in this process, plus those stored with no live agent. When a session title is missing, the row shows the workspace basename and session ID.
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

The panel reads from the same-origin, read-only `/dsh-ballast/api` route: `sessions` lists sessions, `measure&sessionId=` measures one session, `top&limit=` returns cross-session results, and `cold` returns the stored sessions that no live agent owns. The route accepts `GET` and `HEAD`; other methods return `405`. Rows without a parseable token price are marked unpriced and excluded from occupancy bars and token shares.

## Safety and limits

- Measures live sessions on the current host only; sessions on other hosts are not read, and ended sessions are read only through their persistence snapshot, the projection cache, and one batched title read.
- All operations are read-only: no state writes, no message deletion, and no compaction.
- There are no budgets, price tables, compaction forecasts, or content exports.
- On DSH 0.1.5-rc.3 and newer, the API reuses Connection's Host/Origin checks and signed browser cookie.
- Missing or invalid browser authentication returns `401/403`.
- A host that does not mount Connection falls back to the local guard, which decides by TCP peer, Fetch Metadata, `Origin`, and loopback `Host`.
- Under the local guard, a process that can reach the DSH Web port is inside the trust boundary.
- A missing token meter, an ended session, and a failed per-session measurement each return an explicit error. An ended session is out of `measure`'s scope and is listed by `cold` instead.
- A host without heuristic shadow prices shows no price difference; basic measurement is still provided.
- The log length and the inherited prefix come from `Session.seq` and `Session.inheritedEventCount`; reading event content by seq and reading titles in bulk go through `ctx.sessionQuery` (`readSession` / `readTitleSnapshots`). When both are absent, the older host's `.events` array is the fallback.
- The deprecated `Session.eventAt()`, `Session.snapshotEvents()`, and `Session.ownEvents()` are never called; tests assert both the source text and the behaviour.

## Platform and compatibility

| Item | Requirement |
| --- | --- |
| DSH | `>=0.1.5-rc.3` |
| Node.js | `>=20` |

RC1's `seq`, `inheritedEventCount`, and `events` are all supported: with `ctx.sessionQuery` present, event content is read by seq, and without it the older `.events` array is used. A missing projection hides the provider-usage and estimated-mix block; per-message token metering is still provided. A `contextPressure` without a `contextWindow` stays empty rather than being inferred from elsewhere.

## Development and verification

Symlinking the development repository into a running DSH profile lets HMR load an intermediate multi-file edit and terminate the instance. Verification commands:

```powershell
npm test
npm run docs:check
Get-ChildItem lib/*.js | ForEach-Object { node --check $_.FullName }
node --input-type=module -e "import('./lib/index.js').then(m => { if (!m.default || typeof m.default.apply !== 'function') process.exit(1) })"
npm pack --dry-run
```

## License

[MIT](./LICENSE)
