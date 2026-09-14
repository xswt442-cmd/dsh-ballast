# Releasing

Releases are tag-driven. Develop and verify on `dev`, then merge the release
commit into `main`. Only release-ready changes belong on `main`.

## Checklist

1. On `dev`, choose `X.Y.Z` and update:
   - `package.json#version`
   - `lib/shared.js#VERSION`
   - the first section of both changelogs: `## X.Y.Z - YYYY-MM-DD`
2. Make sure the embedded fragments match their canonical sources in
   `dsh-mini-utility-dock` (the dock bootstrap in `lib/client.js`, the loopback
   predicates in `lib/shared.js`). `npm test` fails if either has drifted, and
   `npm run guard:sync` / `npm run dock:sync` rewrites them:

   ```sh
   npm run guard:sync
   npm run dock:sync
   ```

3. Run:

   ```sh
   npm test
   npm run docs:check
   for f in lib/*.js; do node --check "$f"; done
   node --input-type=module -e "import('./lib/index.js').then(m => { if (!m.default || typeof m.default.apply !== 'function') process.exit(1) })"
   npm pack --dry-run
   ```

4. Commit and push the development branch, then merge it into `main` after CI
   passes.
5. From the release commit on `main`, create and push the `vX.Y.Z` tag:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The publish workflow validates the tag and version, reruns the checks, publishes
the package with npm provenance, and creates the GitHub release from
`CHANGELOG.md`. Published npm versions are immutable; deprecate a bad version
and publish a new patch instead of moving a tag.
