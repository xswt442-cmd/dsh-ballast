import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { VERSION } from '../lib/shared.js'

const read = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('both CHANGELOGs open with the version being shipped', () => {
  const heading = new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}(\\s|$)`)
  for (const file of ['../CHANGELOG.md', '../CHANGELOG.en.md']) {
    const first = read(file).split(/\r?\n/).find((line) => line.startsWith('## '))
    assert.ok(first, `${file} has no version section`)
    assert.match(first, heading, `${file} should open with ${VERSION}, got "${first}"`)
  }
})
