# Agent guide

`dsh-ballast` is a DSH host and web plugin that attributes context-window use to
individual messages through the host-only token meter.

## Workflow

- Develop on `dev`; keep `main` release-only.
- Use lowercase Conventional Commit prefixes.
- Never bypass repository hooks with `--no-verify`.
- Keep disposable scripts, generated output, and scratch work out of tracked source.
- Do not link this working tree into an active DSH profile.
- Read `RELEASING.md` only when preparing a release.

## Engineering

- Prefer root-cause fixes to patches and workarounds.
- Keep changes focused; avoid unrelated or speculative refactoring.
- Access optional DSH services only inside `ctx.inject(...)` callbacks.
- Preserve the host-only and read-only boundaries: do not fabricate token or
  pricing data, broaden API methods, or weaken same-origin guards.
- Keep `package.json#version` and `lib/shared.js#VERSION` equal.
- The two marked blocks in `lib/shared.js` are generated from
  `dsh-mini-utility-dock`: `dsh-loopback-helpers` from `dist/loopback.js` and
  `dsh-host-guard` from `dist/guard.js`. Edit the dock fragment and run
  `npm run loopback:sync` / `npm run guard:sync` (either maintains both blocks),
  never the blocks themselves. The guard block depends on the loopback block, so
  keep that order.
- `npm test` verifies both blocks against the dock version this repo pins
  (`loopback:check` / `guard:check`). That is what makes the three plugins hold
  identical blocks, so keep the pin exact and in step with the sibling repos.
- `scripts/guard-parity.mjs` is a local diagnostic, not a CI gate. Run it with
  `DSH_PLUGINS_ROOT` when all three checkouts share a branch; the property it
  asserts cannot hold while a peer sits on a different branch.
- Keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync.

## Verify

```sh
npm test
npm run docs:check
for f in lib/*.js; do node --check "$f"; done
node --input-type=module -e "import('./lib/index.js').then(m => { if (!m.default || typeof m.default.apply !== 'function') process.exit(1) })"
npm pack --dry-run
```
