# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## Unreleased

## 0.2.0 - 2026-09-01

### Added

- **Per-message content preview.** Every surface row now carries a short,
  type-aware excerpt (`lib/preview.js`: one extractor per surface event type —
  `user/message`, `assistant/message`, `tool/result`, `tool/call`, `boundary`)
  so a row that costs 40k tokens says *what* costs 40k tokens instead of being a
  number in a dropdown. Tool results resolve `toolCallId` back to the tool name,
  images report their count rather than their bytes, and content blocks the
  extractor does not know are counted and surfaced as `other` — the panel
  default-denies, so an unknown block reads as "unrecognised", never as the text
  of a guess.
- **Route-vs-heuristic price spread.** `ctx.tokenMeter.measure()` prices each
  node twice: once under the routed adapter (`tokens`), once under the fixed
  heuristic (`heuristicTokens`). The panel shows the difference, which is the
  only way to see that a node's price is a route property and not a message
  property — the heuristic cannot know that the measured route charges for
  vision.
- **Resolved session titles.** The session dropdown led with raw sessionIds. It
  now leads with a title, and says where the title came from (`title` → a
  durable `session/title` event, last one wins; `cwd` → workspace basename;
  `id` → the raw id) — replicating the web UI's own fallback chain. Titles are
  read from the event log rather than `ctx.sessionTitle`, which is a
  `seam`-classified service that may not be mounted at all, and an
  `ctx.inject(['sessionTitle'])` fence would then simply never fire.
- **Shared Dock bootstrap, single-install self-sufficient** (`lib/dock.js`).
  Ballast creates the createhelper utility dock when none exists, so it gets an
  entry point on a machine with neither DIM nor DTK installed. DSH serves a
  plugin's client artifact as one classic script with no bundler at serve time,
  so `lib/client.js` embeds the canonical bytes and `test/dock-parity.test.js`
  fails on drift.
- **`shadowPricing`** — the measurement now states whether the shadow price was
  available at all (`available` / `partial` / `absent` / `unknown`), derived
  from the returned nodes rather than from a version string.
- **CI measure happy path.** The Windows boot-check creates a live session
  through the harness's own `POST /api/session.create` and asserts the full
  return shape, so the read side is no longer only ever tested through its
  failure paths.
- `test/http.test.js` mounts the real host half behind a real loopback socket
  with a priced surface, so the same-origin guard and the per-row contract are
  asserted against traffic.

### Fixed

- **The Δ column was fabricated on hosts without a shadow price, and CI could
  not see it.** `Number(node.heuristicTokens) || 0` coerced an *absent* field to
  `0` — and hosts before `0.1.2-alpha.2` do not emit the field at all. Every one
  of 922 rows in a real session therefore reported `routePriced: true` with
  `priceDelta === tokens`, i.e. the panel claimed a route discount that had
  never been measured, on the machine where the difference mattered most.
  Absence is now carried as absence: `heuristicTokens`, `priceDelta` and
  `routePriced` are `null`, `routePricedCount` is `0`, and the footer says
  `无影子价` instead of showing a price spread. Found only by running the panel
  against real session traffic — the CI boot has no provider route, so it always
  measures 0 nodes and its per-row asserts were unreachable. The step now says
  so as a `::notice::` rather than passing silently.
- **`action=sessions` returned 500 on a live host.** `ctx.inject(names, cb)`
  applies `cb` as a plugin, so the callback receives the derived *scope* and
  services hang off it (`scope.tokenMeter`) rather than arriving as positional
  arguments. Binding them positionally left `sessions` undefined. 67 unit tests
  stayed green through this because the test harness encoded the same
  misunderstanding; it now models the real cordis convention.
- **CI verified only the version line nobody installs.** The boot-check
  installed a bare `@deepseek-ai/dsh`, i.e. `latest` (`0.1.1-rc.2`), while the
  manifest claims `>=0.1.2-alpha.2` — the alpha line was untested, including the
  shadow price the panel depends on. The job is now an `@alpha` / `@latest`
  matrix and prints the host version it is checking.
- **The alpha leg could not have authenticated.** Readiness was "GET `/` answers
  200", but alpha builds gate the shell behind a launch token and answer 401
  until it is redeemed on GET `/` (honoured nowhere else), which is also what
  `POST /api/*` requires. Readiness now means "the port answered at all", and
  token redemption is a separate bounded retry that tolerates the token reaching
  the log after the first 401. rc builds, which announce no token, keep working
  through the same code path.
- **The alpha leg asked for the client bundle at an address the host does not
  serve.** rc publishes `/plugins/<id>/client.js`; alpha concatenates every
  plugin into one combo URL carrying a `rev`, and its handler answers by exact
  `pathname + search`, so anything not advertised — including the same path with
  a different `rev` — is a 404. The check now reads the URL out of the shell HTML
  the host just injected, which is the only component that knows how it addresses
  its own bundles, and asserts the bytes it gets back are the ballast client.
- **The alpha leg created its probe session at the wrong endpoint.** rc claims
  `POST /api/session.create`; alpha claims `POST /api/session/create` and answers
  the dotted form with a 404. Neither shape is derivable from the version the
  manifest claims, so the check probes both and reports which one the running
  host spoke. A future third shape fails the probe loudly instead of skipping
  the read side.

### Changed

- The compat check reports `preview` as the object it actually is (`kind`,
  `text`, `chars`, `truncated`, `blocks`, plus the per-type extras) rather than
  as a string.
- Rows sort heaviest-first everywhere, so the panel's opening question — which
  messages are the ballast — is answerable without reading a table.

## 0.1.0 - 2026-08-31

### Added

- M0 scaffold: a read-only attribution panel over the host-only
  `ctx.tokenMeter.measure(session)`. `GET /dsh-ballast/api?action=sessions` lists
  live sessions; `?action=measure&sessionId=…` returns one session's current
  token surface, per node, joined back to the durable event log by `seq`. The
  official `contextBreakdown` projection deliberately keeps only three O(1)
  numbers and cannot answer "who occupies the window", which is the whole
  product claim of this plugin.
- Same-origin guard on the API route (Fetch Metadata + `Origin` + non-loopback
  `Host`, which also closes DNS rebinding), the `dsh-instance-manager` pattern.
