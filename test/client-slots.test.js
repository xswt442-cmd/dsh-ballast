import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The launcher's seat, the panel's seat, and the disposal path are the browser
// half's whole integration surface. dsh-mini-utility-dock no longer owns any of
// it: the host places the launcher in the composer's tool row and the panel on
// the overlay layer, so this file pins ballast's side of those two seats.
const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('the launcher row and the launcher claim come from the dock fragment', () => {
  const row = /slots\.inject\(UTILITY_ITEM_SLOT[\s\S]*?id:\s*'ballast'[\s\S]*?\(\) => h\(BlMenuItem, null\)\)\)/.exec(CLIENT_SRC)
  assert.ok(row, 'client.js never contributes a row to the family menu')
  assert.match(row[0], /\border:\s*30/)
  assert.match(row[0], /\blabel:\s*\(\)\s*=>\s*tr\('dock\.label'\)/,
    'the row label follows the active DSH locale through a thunk')
  assert.match(CLIENT_SRC, /registerUtilityLauncher\(scope\)/,
    'the client must claim the family launcher when it loads first')
  assert.match(CLIENT_SRC, /\/\/ <dsh-utility-launcher>[\s\S]*\/\/ <\/dsh-utility-launcher>/,
    'the launcher assembly is the dock fragment, marked for launcher:sync')
})

test('the client half is a plugin and mounts its panel through the slot', () => {
  assert.match(CLIENT_SRC, /const plugin = \{\s*apply\(ctx\)/)
  assert.match(CLIENT_SRC, /return plugin/)
  assert.match(CLIENT_SRC, /ctx\.inject\(\['slots'\]/)
  assert.match(CLIENT_SRC, /scope\.slots\.inject\('shell\.overlay'/)
  assert.match(CLIENT_SRC, /ctx\.on\('dispose'/)
})
