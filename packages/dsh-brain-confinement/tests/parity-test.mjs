// Parity guard: the vendored isPathUnder in src/containment.ts must answer
// identically to stock dsh's implementation over a shared matrix. Imports the
// ORIGINAL .ts straight from the local dsh source tree (it depends only on node
// built-ins, so loading that one file needs none of the package's peers).
//
// Override the source checkout with DSH_SOURCE_ROOT. If it is missing, this
// suite is reported as skipped (INCONCLUSIVE), never as a pass.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ok, skip, makeSandbox } from './_harness.mjs'
import { isPathUnder as mine } from '../src/containment.ts'

const SRC = process.env.DSH_SOURCE_ROOT || '../../dsh-monorepo'
const officialFile = join(SRC, 'packages/fs/fs-sandbox/src/containment.ts')

if (!existsSync(officialFile)) {
  skip(`parity: upstream containment.ts not found at ${officialFile} (set DSH_SOURCE_ROOT)`)
} else {
  let official
  try {
    ({ isPathUnder: official } = await import(pathToFileURL(officialFile).href))
  } catch (e) {
    skip(`parity: could not import upstream implementation: ${e?.message || e}`)
  }

  if (official) {
    const sb = makeSandbox()
    try {
      const cases = [
        // [label, candidate, root, expected]
        ['existing file under storages', sb.brainFile, sb.stor, true],
        ['missing file under storages', join(sb.stor, 'nope.json'), sb.stor, true],
        ['missing ancestor under storages', join(sb.stor, 'ghost', 'n.json'), sb.stor, true],
        ['root itself', sb.stor, sb.stor, true],
        ['workdir file vs storages', sb.normalFile, sb.stor, false],
        ['sessions-named sibling vs storages', sb.demoFile, sb.stor, false],
        ['sessions-named sibling vs sessions', sb.demoFile, sb.sess, false],
        ['junction child (existing)', join(sb.link, 'brain_memory.json'), sb.stor, true],
        ['junction child (missing)', join(sb.link, 'nope.json'), sb.stor, true],
        ['junction root itself', sb.link, sb.stor, true],
        ['case-mutated storages', sb.stor.replace(/storages/i, 'STORAGES') + '\\brain_memory.json', sb.stor, true],
        ['session file under sessions root', sb.sessFile, sb.sess, true],
        ['session file vs storages root', sb.sessFile, sb.stor, false],
        ['plain storage vs sessions root', sb.plainFile, sb.sess, false],
      ]

      for (const [label, candidate, root, expected] of cases) {
        const a = await mine(candidate, root, false)
        const b = await official(candidate, root, false)
        ok(`parity[mine=${a}] ${label}`, a === expected)
        ok(`parity[official=${b}] ${label}`, b === expected)
        ok(`parity identical: ${label} (mine=${a}, official=${b})`, a === b)
      }
    } finally {
      sb.cleanup()
    }
  }
}
