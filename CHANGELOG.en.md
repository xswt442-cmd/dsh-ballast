# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Fixed

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
