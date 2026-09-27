# Releasing

Releases are tag-driven. Develop and verify on `dev`, then merge the release
commit into `main`. Only release-ready changes belong on `main`.

## Checklist

1. On `dev`, choose `X.Y.Z` and update:
   - `package.json#version`
   - `lib/shared.js#VERSION`
   - the first section of both changelogs, as `## X.Y.Z - YYYY-MM-DD`

   Keep that heading format: `scripts/release-notes.mjs` cuts the GitHub release
   notes from the matching `CHANGELOG.md` section, and no match means empty notes.
   Confirm it finds the section:

   ```sh
   node scripts/release-notes.mjs X.Y.Z
   ```

2. Sync the embedded fragments from their canonical sources in
   `dsh-mini-utility-dock`: the loopback predicates, the host request guard and
   the host HTTP glue in `lib/shared.js`, the utility launcher in `lib/client.js`.
   One `sync` rewrites every marked block its pinned dock version knows, so
   `loopback:sync`, `guard:sync` and `http:sync` are the same command:

   ```sh
   npm run guard:sync
   npm run launcher:sync
   ```

   A block the pin does not carry is neither written by `sync` nor compared by
   `check`, so a green `npm test` says nothing about it and a fragment newer than
   the pin can ship unverified. Sync such a block from a dock checkout that
   already has the fragment, then raise the pin and re-sync every block in one
   commit: two pushes — old bytes under a new pin, or the reverse — leave CI
   reporting ok about a file it never actually verified.

3. Run:

   ```sh
   npm test
   npm run docs:check
   for f in lib/*.js; do node --check "$f"; done
   node --input-type=module -e "import('./lib/index.js').then(m => { if (!m.default || typeof m.default.apply !== 'function') process.exit(1) })"
   npm pack --dry-run
   ```

4. Push `dev`, open the pull request, and wait for it to go green. Both `compat`
   and `docs` run on `pull_request`, so "CI green" here means those two
   workflows on this branch — the checks the release will be cut from.
5. Merge into `main`. The tag must point at a commit that is already on `main`,
   so pick a merge that keeps the commit you verified reachable: a merge commit
   does, and a squash merge moves the work into a new commit that only the
   resulting `main` commit represents. Tag the `main` commit, never the `dev`
   one — after a squash they are different commits, and the publish workflow
   rejects a tag that is not an ancestor of `main`.
6. From the release commit on `main`, create and push the `vX.Y.Z` tag:

   ```sh
   git switch main
   git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

## What the tag triggers

`publish.yml` runs on any `v*` tag, in three jobs:

- `checks` — one cell per Node floor (`20`, `24`): the tag matches
  `package.json#version`, the tagged commit is an ancestor of `main`, and the
  commands from step 3 run again. This is the job that executes repository
  code, so it holds a read-only token.
- `npm` — publishes with Trusted Publishing and provenance, and skips when the
  version is already on the registry. No npm token exists in this repository:
  the package's Trusted Publishing settings must name this repository and this
  workflow file before the first release.
- `release` — creates the GitHub release from the changelog section. It needs
  `checks` but not `npm`, so a registry hiccup still leaves the notes. It is the
  only job with `contents: write`, and the only one that runs no repository
  code.

The badge row of both READMEs leads with the `ci` badge, which reports the
`compat` workflow on `main`. That is the pipeline a green release assumes; the
`docs` workflow and this publish run carry no badge.

Published npm versions are immutable. Deprecate a bad version and publish a new
patch instead of moving a tag.
