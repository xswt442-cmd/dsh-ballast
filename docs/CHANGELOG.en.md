# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Changed

- The panel header names the host process that answered, by pid and port, and the session count states that it covers only that process's live sessions.
- While the panel is open, a press on the launcher icon acts on the launcher alone instead of also closing the panel.

## 0.3.6 - 2026-09-29

### Maintenance

- No behaviour changed: the client tests now render on the `react` 18 and `react-dom/client` the host ships, with the DOM supplied by `happy-dom`; the assertions and the test count are unchanged, and the explanatory text in `lib/` and `test/` describes current behaviour.

## 0.3.5 - 2026-09-29

### Changed

- The README's opening paragraph states the split against the built-in context display: per-entry attribution, the heaviest entries, and comparison across live sessions come from this plugin.

### Maintenance

- Compatibility verification covers `0.2.0-rc.1`: one real boot on Windows and one on Linux.

## 0.3.4 - 2026-09-29

### Changed

- `CHANGELOG.md`, `CHANGELOG.en.md` and `RELEASING.md` move into `docs/`; the repository root keeps the two READMEs, `LICENSE`, `AGENTS.md` and `CLAUDE.md`. The npm package ships both changelogs at their new paths.

### Maintenance

- The `dsh-mini-utility-dock` dependency is 0.7.0; `docs:check` reads `docs.config.mjs`, the pair declaration this repository owns.

## 0.3.3 - 2026-09-28

### Security

- The host-side JSON reply and session id check come from `dsh-mini-utility-dock`'s `dsh-host-http` fragment, which sets `cache-control: no-store` once for every reply; a body naming ports, pids and session ids is not stored by an intermediary cache.
- Browser authorization is one `authorizeBrowser(req, res)` call built by that fragment, so the admission order is stated once.
- The route's 500 response returns a fixed `code`; the exception text goes to the host log.

### Changed

- The client tests render the bundle in a vm and assert the behaviour of a row or a panel rather than the contents of the source text.

### Maintenance

- Both workflows run on `pull_request`, the matrix drops `@latest` and adds Node 20, and the Linux and Windows cells assert the same measurement contract. Publishing splits into checks / npm / GitHub release jobs; only the release job holds a write token, and a tag must be an ancestor of `main`.
- The npm package includes `CHANGELOG.md` / `CHANGELOG.en.md` / `LICENSE`; `package.json` declares an author; both READMEs lead their badge row with the compatibility CI badge.
- The dock pin is 0.6.0 and all four embedded blocks re-synced; `http:check` covers the fourth block.

## 0.3.2 - 2026-09-25

### Changed

- The sidebar Session row's hover card carries a `sidebar.session.row.hover` seat (`id: ballast`): one line of the occupancy already cached for that session, plus an entry that opens the panel on it. With nothing cached it shows only the entry, so hovering reads nothing from the host.
- The panel entry becomes `dsh-mini-utility-dock`'s shared launcher fragment: one icon at the bottom-left of the page opens a menu of panel entries. The page-local dock protocol and `dock:sync` / `dock:check` are retired.
- Raise the minimum supported DSH version to `0.1.5-rc.3`; the compatibility matrix now pins this baseline and the 0.1.7 line.
- Declare host compatibility: `peerDependencies` and `engines.dsh` both require `>=0.1.5-rc.3`, with the peer marked optional so npm never installs the host. The host's startup preflight uses that declaration to decide whether to disable this plugin.
- Fix the launcher icon disappearing after a hot reload, by syncing `dsh-mini-utility-dock` 0.5.1: its claim on the page is released with its owner, so the icon registers again without a full page reload.

## 0.3.0 - 2026-09-23

### Fixed

- The meter bridge shape-checks the services it binds: a host injecting a tokenMeter without `measure` now reports unavailable instead of `available` followed by a failing request every time.
- Shaping sits inside the same fence as measure: a throw no longer escapes as a 500 and takes the host-wide view down with it.

### Changed

- The declared minimum DSH version is now `>=0.1.2-rc.1`, the line the compatibility CI actually covers.

## 0.2.10 - 2026-09-17

### Changed

- The session panel is smaller overall: width 520 → 440, height cap 680/78vh → 460/62vh.

## 0.2.9 - 2026-09-17

### Changed

- The session view's origin/estimated-mix block and its share-by-type legend are collapsed disclosures now; the totals and the share bar stay visible. Both previously sat between the totals and the entry list, pushing the entries below the first screen.
- The README header uses one consistent badge row.

## 0.2.8 - 2026-09-16

### Maintenance

- The shared-fragment CI check now runs in this repository (`loopback:check` / `guard:check`) instead of comparing across repositories.
- The LICENSE copyright holder is now `xswt442-cmd`.

## 0.2.7 - 2026-09-14

### Security

- Fix a way to bypass the same-origin check: when a `Host` header is present but yields no hostname (for example an unbracketed IPv6 host such as `::1:3080`, which RFC 7230 does not allow), the allowlist was skipped entirely. Such requests are now rejected as non-loopback.
- The IPv4-mapped IPv6 loopback (`[::ffff:127.0.0.1]`, and `[::ffff:7f00:1]` after the URL parser normalises it) counts as loopback on both the Host and the Origin path. This plugin previously rejected it on the Origin path.

### Fixed

- Reaching the plugin over the IPv6 loopback address `::1` no longer gets rejected.
- The Origin port is now read per request from the server's current port instead of being captured when the guard is built, so a server that changes port no longer compares against a stale one.

## 0.2.6 - 2026-09-04

### Changed

- Adapt to the DSH 0.1.2-rc.1 Session read API while retaining the 0.1.2-alpha.2 compatibility fallback.
- Add provider usage, context pressure, and system/tools/messages composition; missing projections degrade cleanly.
- Integrate with the global DSH locale so the panel, Dock, and accessible labels follow language changes.
- Compatibility CI covers `@deepseek-ai/dsh@0.1.2-rc.1`.

### Fixed

- RC1 no longer loses titles, event counts, and per-entry event metadata after removal of the public `session.events` field.
- RC1 browser requests reuse Connection's signed-cookie authentication; an authentication rejection never falls back to the legacy guard.
- The request guard now decides locality from the TCP peer address: non-loopback sources are rejected with 403. Previously a forged `Host: 127.0.0.1` passed the guard, while DSH supports listening on `0.0.0.0`.
- When the service runs on HTTP default port 80, same-origin Origins omitting the port (e.g. `http://127.0.0.1`) are no longer misjudged as cross-origin.
- A whole panel refresh runs under one generation stamp: a selection or view change made while the session-list request is in flight is no longer overwritten by the stale response.
- Failed measure/top requests (DSH restart, HMR socket drop, network error) now surface as an in-panel error instead of an unhandled promise rejection.
- The refresh spinner belongs to the refresh that started it: after closing and reopening the panel, the previous refresh's late response no longer re-enables the button while the newer read is still in flight.
- Unmounting the panel (HMR or plugin dispose) invalidates in-flight reads instead of leaving them holding the component's setState.
- A Dock item with a missing or blank `label` falls back to `id` instead of rendering `aria-label="undefined"`.

## 0.2.5 - 2026-09-03

### Changed

- Compatibility CI covers DSH latest/alpha on Windows and Ubuntu.

### Fixed

- Tightened the local HTTP guard to exact loopback hosts and Origins on the active Web port, with correct IPv6 `[::1]` support.

## 0.2.4 - 2026-09-02

### Fixed

- Tolerate newly created DSH alpha sessions whose event log is not initialized yet, preventing a 500 from the session-list route.

## 0.2.3 - 2026-09-02

### Maintenance

- Add bilingual documentation drift checks and version lockstep tests; releases are driven by the changelog.
- Align the bilingual READMEs, repository guidance, release instructions, and package metadata.

## 0.2.2 - 2026-09-01

### Added

- Added per-type aggregation, cross-session Top, snapshot age, and log-revision memoization.
- Added icon filtering to the Mini Utility Dock.

### Fixed

- Restricted the read-only API to GET/HEAD; missing route prices no longer fabricate a spread.
- Prevented late measurements from overwriting the session selected later by the user.

## 0.2.1 - 2026-09-01

### Maintenance

- npm publishing now uses Trusted Publishing; release checks and GitHub Releases can be retried independently.

## 0.2.0 - 2026-08-31

### Added

- Initial M1 release: per-message token attribution, previews, route-price deltas, and session selection.
