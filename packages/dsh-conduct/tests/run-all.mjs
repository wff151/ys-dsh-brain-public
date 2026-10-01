// Aggregates the dsh-conduct self-tests (pure constant/contract assertions,
// no storage, no LLM). Run from the package dir:
//   node --import tsx/esm tests/run-all.mjs
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here).filter(f => f.endsWith('-test.mjs')).sort()

let passedSuites = 0
let failedSuites = 0
for (const file of files) {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', join(here, file)], { stdio: 'inherit' })
  if (result.status === 0) passedSuites++
  else failedSuites++
}

console.log('\n== run-all summary ==')
console.log(`suites passed: ${passedSuites}, failed: ${failedSuites}`)
process.exit(failedSuites === 0 ? 0 : 1)
