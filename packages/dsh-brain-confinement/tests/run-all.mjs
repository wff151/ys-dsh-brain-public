// Aggregates the dsh-brain-confinement zero-model suites.
//
// Run from the package dir:  node --import tsx/esm tests/run-all.mjs
// Pure Node, no LLM, no dsh host. Every case builds its own throwaway NTFS
// sandbox under .unit-tmp (override with CONF_UNIT_TMP). Environment-dependent
// cases (8.3 short names, reachability of win.ini, upstream source for parity)
// report INCONCLUSIVE skips rather than faking a result.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here)
  .filter(f => f.endsWith('-test.mjs'))
  .sort()

let passedSuites = 0
const failed = []
for (const file of files) {
  console.log(`\n=== ${file} ===`)
  const r = spawnSync(process.execPath, ['--import', 'tsx/esm', join(here, file)], { stdio: 'inherit' })
  if (r.status === 0) passedSuites++
  else failed.push(file)
}

console.log(`\n======== confinement suites: ${passedSuites} ok, ${failed.length} failed ========`)
if (failed.length) {
  console.log('failed suites:', failed.join(', '))
  process.exit(1)
}
