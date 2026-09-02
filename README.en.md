# dsh-ballast

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-ballast)](https://www.npmjs.com/package/dsh-ballast)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A DSH Web context-window attribution plugin. It shows token occupancy and content previews for each entry on the current surface, helping identify what fills the window. It is read-only: it does not estimate spend, modify sessions, or trigger compaction.

## Features

- List user messages, assistant messages, and tool results by token occupancy. Text is whitespace-collapsed and truncated; tool results show their tool name, while reasoning blocks and images are counted but not inlined.
- Show the current route price and, when the host supplies a heuristic shadow price, mark the difference. A difference only indicates that an image may have been repriced as visual tokens; it is not an anomaly or an importance score.
- Show token share aggregated by message type and the heaviest entry in each live session on the current host.
- List live sessions on the current host and open the panel from the Mini Utility Dock; when a title is missing, fall back to the workspace basename and session ID.

## Install

```powershell
# install from npm and register with the web profile (recommended)
dsh plugin --profile web add dsh-ballast

# download the npm package only
npm install dsh-ballast

# or install from GitHub
dsh plugin --profile web add github:xswt442-cmd/dsh-ballast
```

`npm install` downloads the package only; it does not enable the DSH profile. To use the plugin in DSH, add its bundle to a profile. Restart DSH Web after installation and open `ballast` from the Mini Utility Dock.

## Usage

The panel has two views:

- **Current session**: inspect occupancy, type, time, and preview for each entry on the current surface. Entries folded away by a compaction `replace` are not shown.
- **Cross-session top**: on demand, measure each live session on the current host once and sort sessions by their heaviest entry. Cost grows with the session count; one failed session does not block the others.

The panel reads from the same-origin, read-only `/dsh-ballast/api` route: `sessions` lists sessions, `measure&sessionId=` measures one session, and `top&limit=` returns cross-session results. The route accepts `GET` and `HEAD` only. Rows without a parseable token price are marked unpriced and excluded from occupancy bars and token shares.

## Limits and security

- Measures live sessions on the current host only; it does not read ended sessions or sessions on other hosts.
- All operations are read-only: no state writes, message deletion, or compaction; there are no budgets, price tables, compaction forecasts, or content exports.
- The API validates Fetch Metadata, `Origin`, and the loopback `Host`, rejecting cross-site requests and DNS rebinding; mutation-shaped methods return `405`.
- A local process that can reach the DSH Web port remains inside the trust boundary and can read session titles, truncated previews and their original lengths, plus process metadata in the session list.
- Missing host services, ended sessions, and per-session measurement failures return explicit errors. Older hosts without shadow prices retain basic measurement but hide price-difference data.

## Platform and compatibility

| Item | Requirement |
| --- | --- |
| DSH | `>=0.1.2-alpha.2` |
| Node.js | `>=20` |

Capabilities are derived from host-returned data rather than guessed from version strings. The plugin supports the current surface and token-meter data exposed by the host.

## Development and verification

Do not symlink the development repository into a running DSH profile: HMR can load an intermediate multi-file edit and terminate the instance. After changes, run:

```powershell
npm test
npm run docs:check
Get-ChildItem lib/*.js | ForEach-Object { node --check $_.FullName }
npm pack --dry-run
```

## License

[MIT](./LICENSE)
