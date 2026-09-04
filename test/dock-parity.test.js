import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Dock behavior and source parity belong to dsh-mini-utility-dock. These tests
// pin only ballast's integration with that protocol.
const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('the dock entry is registered the way the protocol requires', () => {
  // register() throws TypeError without a non-empty id and onActivate(); a
  // pre-M1 build of this plugin passed { id, title, render } and never got a
  // button. This guards that exact regression.
  const call = /dock\.register\(\{[\s\S]*?\}\)/.exec(CLIENT_SRC)
  assert.ok(call, 'client.js never calls dock.register()')
  const registration = call[0]
  assert.match(registration, /\bid:\s*'ballast'/)
  assert.match(registration, /\blabel:\s*tr\('dock\.label'\)/,
    'the dock label should follow the active DSH locale')
  assert.match(registration, /\bonActivate:\s*\(\)\s*=>/)
  assert.match(registration, /\bonDeactivate:\s*\(\)\s*=>/)
  assert.match(registration, /\border:\s*\d+/)
  assert.ok(!/\brender\s*:/.test(registration), 'the dock takes launchers, not renderers')
  assert.ok(!/\btitle\s*:/.test(registration), 'the dock labels items with `label`, not `title`')
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
