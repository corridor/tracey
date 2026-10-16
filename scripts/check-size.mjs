#!/usr/bin/env node
// Fails when a build outgrows its size budget (gzip). Run after `pnpm build`.
// Budgets sit about 40% above today's sizes: room to grow, not room to bloat.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const KB = 1024
const gz = (file) => gzipSync(readFileSync(file)).length

const assets = join('apps/web/dist/assets')
const files = readdirSync(assets).map((f) => ({ f, size: gz(join(assets, f)) }))
const pick = (re) => files.filter((x) => re.test(x.f)).reduce((n, x) => n + x.size, 0)

const checks = [
  ['website entry JS', pick(/^index-.*\.js$/), 40 * KB],
  ['website parser worker', pick(/^worker-.*\.js$/), 14 * KB],
  ['website CSS', pick(/\.css$/), 6 * KB],
  ['website total (everything the first load fetches, plus the worker)', files.reduce((n, x) => n + x.size, 0), 55 * KB],
  ['CLI bundle', gz('apps/cli/dist/main.js'), 20 * KB],
]

let failed = false
for (const [name, size, budget] of checks) {
  const ok = size <= budget
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${(size / KB).toFixed(1)} KB gzip (budget ${budget / KB} KB)`)
}
if (statSync('apps/web/dist/index.html').size > 4 * KB) {
  failed = true
  console.log('FAIL index.html is larger than 4 KB')
}
process.exit(failed ? 1 : 0)
