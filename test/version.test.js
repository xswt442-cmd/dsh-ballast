import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { VERSION } from '../lib/shared.js'

const read = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('both CHANGELOGs contain the version being shipped', () => {
  // 只要求存在，不要求位置：publish.yml 从匹配 PKG_VERSION 的标题开始收集，
  // 所以它上方的 `## Unreleased` 段落没有影响。真正让发布失败的是完全没有
  // 匹配的段落——发布说明会是空的。
  const heading = new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}(\\s|$)`)
  for (const file of ['../docs/CHANGELOG.md', '../docs/CHANGELOG.en.md']) {
    const sections = read(file).split(/\r?\n/).filter((line) => line.startsWith('## '))
    assert.ok(
      sections.some((line) => heading.test(line)),
      `${file} has no ${VERSION} section; publish.yml would cut empty release notes`
    )
  }
})
