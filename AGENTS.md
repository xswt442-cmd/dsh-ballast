# Agent guide

`dsh-ballast` is a DSH host + web plugin that attributes context-window use to individual messages through the host-only token meter.

## Engineering

- Keep `package.json#version` and `lib/shared.js#VERSION` equal, and keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync.
- The three marked blocks are generated from `dsh-mini-utility-dock`: `dsh-loopback-helpers` and `dsh-host-guard` in `lib/shared.js`, `dsh-utility-launcher` in `lib/client.js`. Edit the dock fragment and run the matching `*.sync` script (`loopback:sync` / `guard:sync` / `launcher:sync`); never edit a block. The guard block depends on the loopback block, so keep that order.
- `npm test` checks all three blocks against the dock version this repo pins (`launcher:check` / `loopback:check` / `guard:check`).
- `dsh-plugin-parity` (from the dock) is a manual diagnostic, not a CI gate: what it asserts cannot hold across checkouts that sit on different branches.
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
