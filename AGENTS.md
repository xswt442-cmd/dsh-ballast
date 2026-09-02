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
- Keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync.

## Verify

```sh
npm test
npm run docs:check
for f in lib/*.js; do node --check "$f"; done
node --input-type=module -e "import('./lib/index.js').then(m => { if (!m.default || typeof m.default.apply !== 'function') process.exit(1) })"
npm pack --dry-run
```
