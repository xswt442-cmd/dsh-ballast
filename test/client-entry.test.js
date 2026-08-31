import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('client bundle registers under the package name', () => {
  assert.ok(client.includes(`id: '${pkg.name}'`), 'client bundle id must match package name')
})

test('client bundle joins the shared utility dock protocol', () => {
  assert.ok(client.includes('__CREATEHELPER_DSH_UTILITY_DOCK_V1__'), 'dock key missing')
  assert.ok(client.includes('createhelper.dsh.utility-dock'), 'dock protocol missing')
})

test('client bundle is a classic script (no node imports)', () => {
  assert.ok(!/\bimport\s+[^'"]*from\s+['"]node:/.test(client), 'client must not import node builtins')
  assert.ok(!/require\('node:/.test(client), 'client must not require node builtins')
})

test('client bundle fetches only its own same-origin api route', () => {
  const routes = [...client.matchAll(/\/dsh-ballast\/api/g)]
  assert.ok(routes.length >= 2, 'panel should hit its own api route')
  assert.ok(!/\/dsh-[a-z-]+\/api/.test(client.replace(/\/dsh-ballast\/api/g, '')), 'client references a foreign plugin api route')
})
