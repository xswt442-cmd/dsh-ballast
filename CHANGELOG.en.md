# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

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
