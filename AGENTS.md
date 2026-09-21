# Agent guide

`dsh-ballast` is a DSH host + web plugin that attributes context-window use to individual messages through the host-only token meter.

## Engineering

- Keep `package.json#version` and `lib/shared.js#VERSION` equal, and keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync.
- The two marked blocks in `lib/shared.js` are generated from `dsh-mini-utility-dock`. Edit the dock fragment and run `npm run loopback:sync` / `npm run guard:sync` (either maintains both blocks); never edit a block. The guard block depends on the loopback block, so keep that order.
- `npm test` checks both blocks against the dock version this repo pins (`loopback:check` / `guard:check`).
- `scripts/guard-parity.mjs` is a manual diagnostic, not a CI gate: what it asserts cannot hold across checkouts that sit on different branches.
- Preserve the read-only and host-only boundaries: never fabricate token or pricing data, broaden API methods, or weaken the same-origin guards.
- Read optional DSH services only inside `ctx.inject(...)` callbacks.

## Verify

```sh
npm test
npm run docs:check
for f in lib/*.js; do node --check "$f"; done
node --input-type=module -e "import('./lib/index.js').then(m => { if (!m.default || typeof m.default.apply !== 'function') process.exit(1) })"
npm pack --dry-run
```
