// 本仓库发布的双语文档对，以及每一对的比较方式。
// `dsh-plugin-docs` 读取这个文件，自己不认识任何文档，所以一对文档可以移动或
// 新增，不需要修改工具。
export const pairs = [
  { name: 'README', zh: 'README.md', en: 'README.en.md' },
  { name: 'CHANGELOG', zh: 'docs/CHANGELOG.md', en: 'docs/CHANGELOG.en.md', shape: 'changelog' },
]
