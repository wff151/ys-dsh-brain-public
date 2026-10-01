// Parity guard for the home resolver: the vendored resolveDshHome in
// src/paths.ts must agree with stock @deepseek-ai/dsh-home-paths over a shared
// precedence matrix. We import the ORIGINAL .ts straight from the local dsh
// source tree (it depends only on node built-ins), exactly like parity-test.mjs
// does for isPathUnder. Run after every dsh upgrade.
//
// Two INTENTIONAL departures are pinned separately at the bottom — they must
// NOT be "fixed" to match upstream silently:
//   1. blank/whitespace `configured`: upstream selects it via `??` and
//      resolves it against cwd; ours treats it as unset (config defaults to '').
//   2. `~` expansion: upstream always uses os.homedir() (no injection); ours
//      takes an injectable home for deterministic tests. Tilde parity rows
//      therefore call ours with the DEFAULT home so both sides use homedir().
//
// Override the source checkout with DSH_SOURCE_ROOT. Missing source = skip.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ok, eq, skip } from './_harness.mjs'
import { resolveDshHome as mine } from '../src/paths.ts'

const SRC = process.env.DSH_SOURCE_ROOT || '../../dsh-monorepo'
const officialFile = join(SRC, 'packages/util/home-paths/src/index.ts')

if (!existsSync(officialFile)) {
  skip(`resolver parity: upstream home-paths not found at ${officialFile} (set DSH_SOURCE_ROOT)`)
} else {
  let official
  try {
    ({ resolveDshHome: official } = await import(pathToFileURL(officialFile).href))
  } catch (e) {
    skip(`resolver parity: could not import upstream implementation: ${e?.message || e}`)
  }

  if (official) {
    // Rows where both implementations MUST agree. Absolute configured/env
    // values keep cwd and homedir out of the result; tilde rows call ours with
    // the default home, so both sides expand against the same os.homedir().
    const H = homedir()
    const sameRows = [
      // [label, configured, env]
      ['configured wins over env', 'E:\\cfg-home', { DSH_HOME: 'E:\\env-home' }],
      ['env used when configured absent', undefined, { DSH_HOME: 'E:\\env-home' }],
      ['blank env falls back to ~/.dsh', undefined, { DSH_HOME: '   ' }],
      ['nothing set falls back to ~/.dsh', undefined, {}],
      ['whitespace configured AND env -> ~/.dsh via env path below', undefined, { DSH_HOME: '' }],
      ['relative configured resolves against cwd', join('rel', 'proj'), {}],
      ['tilde configured expands home', '~/proj', {}],
      ['bare tilde configured expands home', '~', {}],
      ['backslash tilde configured expands home', '~\\proj', {}],
      ['tilde comes from env too', undefined, { DSH_HOME: '~/envproj' }],
    ]

    for (const [label, configured, env] of sameRows) {
      // ours with DEFAULT home (3rd arg omitted) -> identical homedir basis
      const a = mine(configured, env)
      const b = official(configured, env)
      eq(`resolver parity: ${label} (mine=${a})`, a, b)
    }

    // Sanity on the tilde rows' actual value (not just equality): they must
    // point under the real os home, not cwd.
    eq('tilde value anchored at homedir', mine('~/proj', {}), resolve(H, 'proj'))
    eq('env tilde value anchored at homedir',
      mine(undefined, { DSH_HOME: '~/envproj' }), resolve(H, 'envproj'))

    // --- INTENTIONAL DEPARTURES, pinned so upstream drift is still visible ---
    // Upstream: configured ?? ... -> '' is NOT nullish -> resolve('') === cwd,
    // and '   ' resolves to a cwd-relative trailing-space path. Ours treats a
    // blank/whitespace configured value as unset and moves to env, because our
    // schema defaults dshHome to '' and cwd would silently relocate the roots.
    const envHome = { DSH_HOME: 'E:\\env-home' }
    eq('departure: upstream empty-configured tracks cwd', official('', envHome), resolve(''))
    eq('departure: upstream blank-configured tracks resolve()',
      official('   ', envHome), resolve('   '))
    eq('departure: ours empty-configured uses env', mine('', envHome, 'E:\\fake'), 'E:\\env-home')
    eq('departure: ours blank-configured uses env', mine('   ', envHome, 'E:\\fake'), 'E:\\env-home')
    ok('departure is real: empty configured answers differ',
      official('', envHome) !== mine('', envHome))
    ok('departure is real: blank configured answers differ',
      official('   ', envHome) !== mine('   ', envHome))

    // Injectable home: ours can resolve against a fake home; upstream cannot.
    eq('injection: ours uses supplied home',
      mine(undefined, {}, 'E:\\fake-home'), resolve('E:\\fake-home', '.dsh'))
  }
}
