// The "Where things stand" table in features/README.md: scenarios per feature by status tag (@built / @partly /
// @missing), Scenario Outline examples expanded. Pull requests leave the table alone; the features-table workflow
// runs this on main and commits the result.
//   node features/table.mjs          rewrite the table in features/README.md
//   node features/table.mjs --print  print it instead
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dir = new URL('./', import.meta.url)
const STATUSES = ['built', 'partly', 'missing']
const rows = []
for (const name of readdirSync(dir).filter((f) => f.endsWith('.feature')).sort()) {
  const counts = { built: 0, partly: 0, missing: 0 }
  let tags = []
  let outline = null // { tags } while inside a Scenario Outline
  let examples = null // { tags } while inside an Examples table
  let header = false
  for (const raw of readFileSync(new URL(name, dir), 'utf8').split('\n')) {
    const line = raw.trim()
    if (line.startsWith('@')) { tags.push(...line.split(/\s+/)); continue }
    if (/^Scenario Outline:/.test(line)) { outline = { tags }; examples = null; tags = []; continue }
    if (/^Scenario:/.test(line)) {
      const s = STATUSES.find((t) => tags.includes(`@${t}`))
      if (s) counts[s]++
      outline = null; examples = null; tags = []; continue
    }
    if (/^Examples:/.test(line) && outline) { examples = { tags: [...outline.tags, ...tags] }; header = true; tags = []; continue }
    if (line.startsWith('|') && examples) {
      if (header) { header = false; continue }
      const s = STATUSES.find((t) => examples.tags.includes(`@${t}`))
      if (s) counts[s]++
      continue
    }
    if (line && !line.startsWith('#')) tags = []
  }
  rows.push([name, counts])
}
const total = { built: 0, partly: 0, missing: 0 }
const lines = ['| Feature | Built | Partly | Missing |', '| --- | ---: | ---: | ---: |']
for (const [name, c] of rows) {
  STATUSES.forEach((s) => (total[s] += c[s]))
  lines.push(`| \`${name}\` | ${c.built} | ${c.partly} | ${c.missing} |`)
}
lines.push(`| **All ${rows.length}** | **${total.built}** | **${total.partly}** | **${total.missing}** |`)
const table = lines.join('\n') + '\n'

if (process.argv.includes('--print')) {
  process.stdout.write(table)
} else {
  const readme = new URL('README.md', dir)
  const text = readFileSync(readme, 'utf8')
  const start = text.indexOf('| Feature | Built')
  const end = text.indexOf('\n', text.indexOf('| **All', start)) + 1
  if (start < 0 || end <= 0) throw new Error('no table in features/README.md')
  writeFileSync(readme, text.slice(0, start) + table + text.slice(end))
}
