import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// lib/dock.js is the canonical shared copy; lib/client.js ships it inline
// because DSH serves one self-contained classic script per plugin. These tests
// keep the two from drifting, and pin the registration shape the dock actually
// accepts.

const DOCK_SRC = readFileSync(new URL('../lib/dock.js', import.meta.url), 'utf8')
const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const codeLines = (src) => src.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')

test('lib/dock.js is embeddable: no ESM syntax', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(DOCK_SRC), 'a classic script cannot import or export')
  assert.ok(!DOCK_SRC.includes('require('), 'the dock module must not reach for a module system')
})

test('client.js embeds the canonical dock module verbatim', () => {
  const dock = codeLines(DOCK_SRC)
  const start = dock.findIndex((line) => line.startsWith('const DOCK_KEY'))
  assert.ok(start >= 0, 'lib/dock.js must declare DOCK_KEY')
  const body = dock.slice(start)
  const client = codeLines(CLIENT_SRC)
  const at = client.indexOf(body[0])
  assert.ok(at >= 0, 'client.js does not embed the shared dock bootstrap at all')
  assert.deepEqual(
    client.slice(at, at + body.length),
    body,
    'client.js drifted from lib/dock.js — copy lib/dock.js in wholesale'
  )
  assert.equal(client.slice(at + body.length).find((line) => line.startsWith('const DOCK_KEY')), undefined,
    'client.js carries a second copy of the dock bootstrap')
})

test('the dock entry is registered the way the protocol requires', () => {
  // register() throws TypeError without a non-empty id and onActivate(); a
  // pre-M1 build of this plugin passed { id, title, render } and never got a
  // button. This guards that exact regression.
  const call = /dock\.register\(\{[\s\S]*?\}\)/.exec(CLIENT_SRC)
  assert.ok(call, 'client.js never calls dock.register()')
  const registration = call[0]
  assert.match(registration, /\bid:\s*'ballast'/)
  assert.match(registration, /\blabel:\s*'ballast'/)
  assert.match(registration, /\bonActivate:\s*\(\)\s*=>/)
  assert.match(registration, /\bonDeactivate:\s*\(\)\s*=>/)
  assert.match(registration, /\border:\s*\d+/)
  assert.ok(!/\brender\s*:/.test(registration), 'the dock takes launchers, not renderers')
  assert.ok(!/\btitle\s*:/.test(registration), 'the dock labels items with `label`, not `title`')
})

test('the icon ballast registers is one the shared dock will admit', () => {
  // safeDockIcon is defined without touching the DOM, so the canonical bytes
  // can be evaluated as-is here.
  const safeDockIcon = new Function(`${DOCK_SRC}\nreturn safeDockIcon`)()
  const literal = /const BALLAST_ICON = ('[^']*'|"[^"]*")/.exec(CLIENT_SRC)
  assert.ok(literal, 'client.js does not declare BALLAST_ICON')
  const icon = new Function(`return ${literal[1]}`)()
  assert.equal(safeDockIcon(icon), true,
    'the dock would render a fallback for the icon ballast ships')
})

test('ballast self-bootstraps instead of waiting for another plugin', () => {
  // Single-install was the M1 blocker: joining a dock only DIM/DTK create means
  // no entry point at all when ballast is the only plugin installed.
  assert.match(CLIENT_SRC, /const dock = getUtilityDock\(\)/)
  assert.ok(!/if\s*\(isCompatibleDock\(window\[DOCK_KEY\]\)\)\s*\{/.test(CLIENT_SRC),
    'the client must not silently skip registering when no dock exists yet')
})

test('the client half is a plugin and mounts its panel through the slot', () => {
  assert.match(CLIENT_SRC, /const plugin = \{\s*apply\(ctx\)/)
  assert.match(CLIENT_SRC, /return plugin/)
  assert.match(CLIENT_SRC, /ctx\.inject\(\['slots'\]/)
  assert.match(CLIENT_SRC, /scope\.slots\.inject\('shell\.overlay'/)
  assert.match(CLIENT_SRC, /ctx\.on\('dispose'/)
  assert.match(CLIENT_SRC, /dockItem\?\.dispose\(\)/)
})
