# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

## 0.2.8 - 2026-09-16

### Changed

- CI no longer runs the cross-repo `guard-parity` job. The shared fragments are verified locally by this repo's `npm test` (`loopback:check` / `guard:check`) against the dock version it pins: dock versions are immutable once published and consumers pin an exact version, so "all three pin the same version" already implies "all three hold byte-identical blocks", making the cross-repo comparison redundant.
- `scripts/guard-parity.mjs` becomes a manual diagnostic rather than a CI gate. It now asserts that the three repos pin the same dock version and reach the same conclusion on every decision. `AGENTS.md` records why it is not a gate: a peer checkout resolves to the default branch, so the property it asserts does not hold there and it reports false failures.
- The LICENSE copyright holder is now `xswt442-cmd`.

## 0.2.7 - 2026-09-14

### Security

- The same-origin request guard now comes from a fragment shared through `dsh-mini-utility-dock`. The three plugins previously maintained one `createGuard` each, and the copies had drifted three times: all three rejected the IPv6 loopback `::1`; the three disagreed on which Host spellings count as loopback; and an unbracketed IPv6 Host (for example `::1:3080`, which RFC 7230 forbids) silently skipped the Host allowlist. One implementation now decides, and each plugin keeps only its own error codes and wording.
- The IPv4-mapped IPv6 loopback (`::ffff:127.0.0.1`, and `::ffff:7f00:1` after the URL parser normalises it) counts as loopback on both the Host and the Origin path. This plugin previously rejected that form while DSH Instance Manager admitted it.
- A Host header that is present but parses to no hostname is treated as non-loopback. That case previously skipped the allowlist.
- The decision of what counts as loopback is no longer held by this plugin: it comes from a generated fragment, and cross-repo consistency is checked by `scripts/guard-parity.mjs`, which compares both fragments byte for byte, verifies no private implementation sits beside them, and asserts the three plugins reach the same answer for every decision.

### Changed

- The Origin port is now read per request from the server's current port instead of being captured when the guard is built.

## 0.2.6 - 2026-09-04

### Changed

- Adapt to the DSH 0.1.2-rc.1 Session read API while retaining the 0.1.2-alpha.2 compatibility fallback.
- Add provider usage, context pressure, and system/tools/messages composition; missing projections degrade cleanly.
- Integrate with the global DSH locale so the panel, Dock, and accessible labels follow language changes.
- Explicitly cover `@deepseek-ai/dsh@0.1.2-rc.1` in compatibility CI.

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

- Host cleanup now follows the Cordis effect lifecycle; compatibility CI covers DSH latest/alpha on Windows and Ubuntu.

### Fixed

- Tightened the local HTTP guard to exact loopback hosts and Origins on the active Web port, with correct IPv6 `[::1]` support.

## 0.2.4 - 2026-09-02

### Changed

- The Mini Utility Dock is now synchronized at build time from `dsh-mini-utility-dock`, which owns the protocol tests.

### Fixed

- Tolerate newly created DSH alpha sessions whose event log is not initialized yet, preventing a 500 from the session-list route.

## 0.2.3 - 2026-09-02

### Changed

- Simplified and aligned the bilingual READMEs, repository guidance, release instructions, and package metadata.
- Added bilingual documentation drift checks, version lockstep tests, and changelog-driven idempotent releases.

## 0.2.2 - 2026-09-01

### Added

- Added per-type aggregation, cross-session Top, snapshot age, and log-revision memoization.
- Added icon filtering to the Mini Utility Dock.

### Fixed

- Restricted the read-only API to GET/HEAD; missing route prices no longer fabricate a spread.
- Prevented late measurements from overwriting the session selected later by the user.

## 0.2.1 - 2026-09-01

### Changed

- npm publishing now uses the package name and Trusted Publishing; release checks and GitHub Releases can be retried independently.

## 0.2.0 - 2026-08-31

### Added

- Initial M1 release: per-message token attribution, previews, route-price deltas, and session selection.
