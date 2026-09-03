import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { VERSION } from '../lib/shared.js'

const read = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('both CHANGELOGs contain the version being shipped', () => {
  // Existence, not position: publish.yml starts collecting at the heading that
  // matches PKG_VERSION, so an `## Unreleased` section above it is harmless.
  // What actually breaks releases is no matching section at all -> empty notes.
  const heading = new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}(\\s|$)`)
  for (const file of ['../CHANGELOG.md', '../CHANGELOG.en.md']) {
    const sections = read(file).split(/\r?\n/).filter((line) => line.startsWith('## '))
    assert.ok(
      sections.some((line) => heading.test(line)),
      `${file} has no ${VERSION} section; publish.yml would cut empty release notes`
    )
  }
})
