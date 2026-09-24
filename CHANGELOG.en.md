# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Changed

- The panel launcher becomes the family's shared launcher: one 30px icon at the bottom-left of the work area (the host's `shell.overlay` layer, positioned by the sidebar's right edge + 16, 80 while the shell has not laid the column out) that opens a menu listing the three panels. The assembly comes from the new `dsh-utility-launcher` fragment in `dsh-mini-utility-dock` (maintained here with `launcher:sync` / `launcher:check`, which `npm test` runs), and this plugin only contributes its own row; the page-level dock protocol is gone, and the old `dock:sync` / `dock:check` for `client.js` with it.
- Raise the minimum supported DSH version to `0.1.5-rc.3`; the compatibility matrix now pins this baseline and `0.1.7-rc.1`.

## 0.3.0 - 2026-09-23

### Fixed

- The meter bridge shape-checks the services it binds: a host injecting a tokenMeter without `measure` no longer reports `available` and then fails every request.
- Shaping sits inside the same fence as measure: a throw used to escape as a 500 and take the host-wide view down with it.

### Changed

- The declared minimum DSH version is now `>=0.1.2-rc.1` (was `>=0.1.2-alpha.2`; CI never covered the alpha line).

## 0.2.10 - 2026-09-17

### Changed

- The session panel is smaller overall: width 520 → 440, height cap 680/78vh → 460/62vh. It used to be far larger than its content, covering most of the screen for a handful of entries.

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
