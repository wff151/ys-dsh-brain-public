// Minimal zero-model test helpers shared by the confinement suites.
// A suite exits non-zero on any failed ok(); skips are reported, never faked.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let passed = 0
let failed = 0
const skips = []

export function ok(name, cond) {
  if (cond) { passed += 1 }
  else { failed += 1; console.log('  FAIL:', name) }
}
export function eq(name, actual, expected) {
  ok(`${name}  [got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}]`, actual === expected)
}
export function skip(reason) {
  skips.push(reason)
  console.log('  SKIP:', reason)
}

process.on('exit', () => {
  console.log(`\n${passed} passed, ${failed} failed, ${skips.length} skipped`)
  for (const s of skips) console.log('  - skipped:', s)
  if (failed > 0) process.exitCode = 1
})

// Real on-disk sandbox on the SAME NTFS volume as production by default so
// junction identity behavior is genuine. Override with CONF_UNIT_TMP.
const DEFAULT_UNIT_ROOT = '../../../packages/dsh-brain-confinement/.unit-tmp'

export function makeSandbox() {
  const root = process.env.CONF_UNIT_TMP || DEFAULT_UNIT_ROOT
  mkdirSync(root, { recursive: true })
  const T = mkdtempSync(join(root, 'u-'))
  const home = join(T, 'dshhome')
  const stor = join(home, 'storages')
  const sess = join(home, 'sessions')
  const work = join(T, 'work')
  const sub = join(work, 'sub')
  const demo = join(T, 'proj-sessions-demo')
  for (const d of [stor, sess, sub, demo]) mkdirSync(d, { recursive: true })

  const brainFile = join(stor, 'brain_memory.json')
  const plainFile = join(stor, 'plain.txt')
  const sessFile = join(sess, 'probe-canary.txt')
  const normalFile = join(work, 'normal.txt')
  const demoFile = join(demo, 'note.txt')
  writeFileSync(brainFile, '{"canary":"CANARY-READ"}', 'utf8')
  writeFileSync(plainFile, 'plain CANARY-READ file', 'utf8')
  writeFileSync(sessFile, 'session CANARY-SESS', 'utf8')
  writeFileSync(normalFile, 'safe CANARY-SAFE', 'utf8')
  writeFileSync(demoFile, 'folder name contains sessions but is a sibling CANARY-SAFE', 'utf8')

  // Workdir junction pointing INTO the protected store (no admin on Windows).
  const link = join(work, 'storelink')
  symlinkSync(stor, link, 'junction')

  return {
    T, home, stor, sess, work, sub, demo,
    brainFile, plainFile, sessFile, normalFile, demoFile, link,
    cleanup: () => rmSync(T, { recursive: true, force: true }),
  }
}

export { tmpdir }
