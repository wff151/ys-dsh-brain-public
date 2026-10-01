// Stage 6: adversarial fuzz of the decision layer (zero-model, seeded, deterministic).
//
// Covers the "unknown forms" gap the 253 fixed assertions leave open. Mutation
// dimensions per STATE.md: case, `..` depth, trailing dots, `\\?\` verbatim,
// separator mix, quotes, junction identity, overlong/pathological strings.
//
// Families:
//   F1 crash-invariance    - garbage/typed inputs never throw on either classifier.
//   F2 protected-equiv     - every Windows-equivalent spelling of a protected path
//                            is still DENIED (fs + shell); oracle sanity-checks that
//                            the mutation really is equivalent.
//   F3 safe-preservation   - the same mutation families on safe paths never DENY.
//   F4 shell template      - seeded command templates: expected category asserted
//                            (protected / candidate-allow / no-candidate / unresolvable).
//   F5 candidate cap       - > MAX_COMMAND_CANDIDATES tokens bucket unresolvable
//                            (or protected when an early literal hits); never throws.
//   F6 path stress         - long/deep/`..`-heavy paths: verdict must equal an
//                            independent resolve()+isPathUnder oracle.
//
// The trailing-dot channel asymmetry is honored: fs follows Node semantics (no
// normalization -> NOT equivalent), shell follows PowerShell/cmd (normalization ->
// equivalent). 8.3 short names are env-dependent -> skipped, never faked.
import { join, resolve } from 'node:path'
import { ok, eq, makeSandbox, skip } from './_harness.mjs'
import { classifyFsCall, canonicalizeCandidate, ProtectedRootResolver, makeProtectedRoots, stripVerbatimPrefix } from '../src/paths.ts'
import { classifyShellCall, isShellTool, MAX_COMMAND_CANDIDATES } from '../src/shell.ts'
import { isPathUnder } from '../src/containment.ts'

// Deterministic PRNG so every run exercises the identical corpus.
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sb = makeSandbox()
let cleanupDone = false
const finish = () => { if (!cleanupDone) { cleanupDone = true; sb.cleanup() } }
process.on('exit', finish)

const roots = makeProtectedRoots(sb.home) // [home\storages, home\sessions]
const resolver = new ProtectedRootResolver(sb.home, {})
const fsCall = (file_path, opts = {}) =>
  classifyFsCall(opts.tool ?? 'read', { file_path }, {
    base: opts.base,
    resolver,
    caseSensitive: false,
  })
const shCall = (command, opts = {}) =>
  classifyShellCall('pwsh', { command, ...(opts.args ?? {}) }, {
    base: opts.base ?? sb.work,
    resolver,
    caseSensitive: false,
    platform: opts.platform ?? 'win32',
  })

/** Independent oracle: does the canonicalized absolute sit under any root? */
async function oracleProtected(raw, base) {
  const abs = canonicalizeCandidate(raw, base)
  if (abs === undefined) return null // cannot place -> classifier fail-closed or skip
  for (const root of roots) {
    if (await isPathUnder(abs, root, false)) return true
  }
  return false
}

/** Replicates shell.ts normalizeShellSegments (win32): trailing dots/spaces on
 *  components are eaten, `.`/`..` segments are preserved. Used ONLY so the F2/F3
 *  shell oracle sees the same normalized spelling the classifier places. */
function shellNorm(p) {
  const parts = p.split(/[\\/]+/).filter(part => part.length > 0)
  const stripped = parts.map(part =>
    (part === '.' || part === '..') ? part : part.replace(/[ .]+$/g, ''))
  const prefix = p.startsWith('\\\\') ? '\\\\' : (p.startsWith('\\') || p.startsWith('/') ? '\\' : '')
  const driveish = /^[a-zA-Z]:$/.test(stripped[0] ?? '')
  return driveish ? stripped.join('\\') : prefix + stripped.join('\\')
}

/** Replicates shell.ts dequoteAndVerbatim: unwrap quotes -> strip verbatim to a
 *  fixpoint. Must run BEFORE shellNorm so a `\\?\` prefix survives normalization
 *  exactly like the classifier's judge() order. */
function dequoteAndVerbatimLocal(p) {
  let cur = p.trim()
  for (let i = 0; i < 6; i += 1) {
    const u = (cur.length >= 2 && (cur[0] === '"' || cur[0] === "'") && cur[0] === cur[cur.length - 1])
      ? cur.slice(1, -1)
      : cur
    const next = stripVerbatimPrefix(u).trim()
    if (next === cur) break
    cur = next
  }
  return cur
}

/** Shell oracle: same pipeline order as judge() — dequote/verbatim FIRST, then
 *  shell normalization, then containment. */
async function shellOracle(raw, base) {
  return oracleProtected(shellNorm(dequoteAndVerbatimLocal(raw)), base)
}

// ---------------------------------------------------------------------------
// mutation builders over a base path
// ---------------------------------------------------------------------------
const flipCase = (p) => {
  const r = mulberry32(p.length * 7919 + 13)
  return p.split('').map(ch => {
    const c = ch.charCodeAt(0)
    const lower = (c >= 0x41 && c <= 0x5A)
    const upper = (c >= 0x61 && c <= 0x7A)
    if ((lower || upper) && r() < 0.5) return String.fromCharCode(c ^ 0x20)
    return ch
  }).join('')
}
const withVerbatim = p => `\\\\?\\${p}`
const withSlashes = p => p.replace(/\\/g, '/')
const withDupSeps = (p) => { const r = mulberry32(p.length * 104729 + 7); return p.replace(/\\/g, m => (r() < 0.4 ? '\\\\' : m)) }
const withDotSegs = (p) => p.replace(/\\/g, m => '\\\\.\\')
const withQuotes = p => (p.length & 1) ? `'${p}'` : `"${p}"`
const withNestedQuotes = p => `'"\\\\?\\${p}"'`
const withDotDot = p => {
  // X\a\b -> X\a\.\b  and  X\a\b -> X\a\..\a\b  (both resolve identically)
  const r = mulberry32(p.length * 31337 + 29)
  const parts = p.split('\\')
  const out = []
  for (let i = 0; i < parts.length; i++) {
    out.push(parts[i])
    if (i > 0 && i < parts.length - 1 && r() < 0.5) out.push('.')
    if (i > 0 && i < parts.length - 2 && r() < 0.25) out.push('..', parts[i])
  }
  return out.join('\\')
}
const junctionRel = p => {
  // work\storelink is a junction into home\storages (created by makeSandbox).
  if (p === sb.brainFile) return 'storelink\\brain_memory.json'
  return p
}
// shell-only: PowerShell/cmd eat trailing dots/spaces on components
const withTrailingDot = p => {
  const parts = p.split('\\')
  if (parts.length < 2) return p
  const r = mulberry32(p.length * 65537 + 5)
  return parts.map((part, i) =>
    i < parts.length - 1 && part !== '' && r() < 0.5 ? `${part}.` : part
  ).join('\\')
}
const withTrailingSpace = p => `"${p.split('\\').join(' \\')}"`

const FS_MUTATORS = [flipCase, withVerbatim, withSlashes, withDupSeps, withDotSegs, withQuotes, withNestedQuotes, withDotDot, junctionRel]
const SHELL_MUTATORS = [...FS_MUTATORS, withTrailingDot, withTrailingSpace]

// ---------------------------------------------------------------------------
// F1 crash-invariance
// ---------------------------------------------------------------------------
{
  const garbageFs = [
    undefined, null, 42, true, {}, [], { file_path: 42 }, { file_path: null },
    { file_path: {} }, { file_path: ['x'] }, { file_path: '\u0000' },
    { file_path: 'x'.repeat(100000) }, { file_path: '\uD800\uDC00' },
    { OTHER: 'E:\\storages\\x' }, { file_path: '' },
  ]
  for (let i = 0; i < garbageFs.length; i++) {
    const d = await classifyFsCall('read', garbageFs[i], { resolver, caseSensitive: false })
    ok(`F1 fs garbage #${i} returns a decision`, d !== undefined && d !== null && typeof d === 'object')
    ok(`F1 fs garbage #${i} has a boolean protected`, typeof d.protected === 'boolean')
  }
  // tools outside the fs taxonomy must short-circuit evaluated:false, never throw
  const exoticFs = await classifyFsCall('something-else', { file_path: sb.brainFile }, { resolver, caseSensitive: false })
  eq('F1 non-fs tool -> evaluated:false', exoticFs.evaluated, false)

  const garbageShell = [
    undefined, null, 42, true, {}, [], { command: 42 }, { command: null },
    { command: {} }, { command: ['Get-Content x'] }, { command: '\u0000' },
    { command: 'x'.repeat(100000) }, { command: '\uD800\uDC00' }, { command: '' },
  ]
  for (let i = 0; i < garbageShell.length; i++) {
    const d = await shCall(garbageShell[i]?.command ?? garbageShell[i], {})
    ok(`F1 shell garbage #${i} returns a decision`, d !== undefined && typeof d === 'object')
    ok(`F1 shell garbage #${i} has a boolean protected`, typeof d.protected === 'boolean')
  }
  const exoticShell = await classifyShellCall('read', { file_path: 'x' }, { base: sb.work, resolver })
  eq('F1 non-shell tool -> no-decision symbol', typeof exoticShell, 'symbol')
}

// ---------------------------------------------------------------------------
// F2 protected equivalence (fs + shell)
// ---------------------------------------------------------------------------
{
  let n = 0
  for (const [name, base, baseOpt] of [
    ['brainFile', sb.brainFile, {}],
    ['plainFile', sb.plainFile, {}],
    ['sessFile', sb.sessFile, {}],
    ['brainFile-rel-work', 'storelink\\brain_memory.json', { base: sb.work }],
  ]) {
    for (const mut of FS_MUTATORS) {
      const raw = mut(base)
      if (typeof raw !== 'string' || raw.length === 0) continue
      const d = await fsCall(raw, baseOpt)
      const oracle = await oracleProtected(raw, baseOpt.base)
      ok(`F2 fs ${name} ${mut.name} -> protected`, d.protected === true,
        `[raw=${JSON.stringify(raw.slice(0, 90))}]`)
      if (oracle !== null) {
        ok(`F2 fs ${name} ${mut.name} oracle agrees`, oracle === true)
      }
      n += 1
    }
  }
  ok(`F2 fs corpus exercised ${n} mutations`, n >= 20)
}

{
  let n = 0
  for (const [name, path] of [
    ['brainFile', sb.brainFile],
    ['plainFile', sb.plainFile],
    ['sessFile', sb.sessFile],
  ]) {
    for (const mut of SHELL_MUTATORS) {
      const raw = mut(path)
      if (typeof raw !== 'string' || raw.length === 0) continue
      // shell judges via a command that embeds the candidate
      const d = await shCall(`Get-Content ${raw}`)
      // oracle sees the shell pipeline order: dequote/verbatim, then normalize
      const oracle = await shellOracle(raw, sb.work)
      ok(`F2 shell ${name} ${mut.name} -> protected`, d.protected === true,
        `[raw=${JSON.stringify(raw.slice(0, 90))}]`)
      if (oracle !== null) {
        ok(`F2 shell ${name} ${mut.name} oracle agrees`, oracle === true)
      }
      n += 1
    }
  }
  // env-var built forms (the one env we expand authoritatively)
  for (const tmpl of [
    '$env:DSH_HOME\\storages\\brain_memory.json',
    '${env:DSH_HOME}\\storages\\brain_memory.json',
    '${DSH_HOME}\\storages\\brain_memory.json',
    '"$env:DSH_HOME\\storages\\brain_memory.json"',
    "'$env:DSH_HOME\\storages\\brain_memory.json'",
  ]) {
    const d = await shCall(`Get-Content ${tmpl}`)
    eq(`F2 shell env-built ${tmpl} -> protected`, d.protected, true)
    n += 1
  }
  ok(`F2 shell corpus exercised ${n} mutations`, n >= 20)
}

// ---------------------------------------------------------------------------
// F3 safe preservation (fs + shell): same families must NOT deny
// ---------------------------------------------------------------------------
{
  let n = 0
  for (const [name, safe] of [
    ['normalFile', sb.normalFile],
    ['demoFile', sb.demoFile],
    ['subdir', join(sb.work, 'sub')],
    ['normal-rel', 'normal.txt'],
    ['demo-rel', join(sb.demo, 'note.txt')],
  ]) {
    for (const mut of FS_MUTATORS) {
      const raw = mut(safe)
      if (typeof raw !== 'string' || raw.length === 0) continue
      const d = await fsCall(raw, { base: sb.work })
      const oracle = await oracleProtected(raw, sb.work)
      ok(`F3 fs ${name} ${mut.name} -> not protected`, d.protected === false,
        `[raw=${JSON.stringify(raw.slice(0, 90))}]`)
      if (oracle !== null) ok(`F3 fs ${name} ${mut.name} oracle agrees`, oracle === false)
      n += 1
    }
  }
  ok(`F3 fs corpus exercised ${n} mutations`, n >= 15)
}

{
  let n = 0
  for (const [name, safe] of [
    ['normalFile', sb.normalFile],
    ['demoFile', sb.demoFile],
    ['normal-rel', 'normal.txt'],
    ['sub-rel', 'sub\\x.txt'],
  ]) {
    for (const mut of SHELL_MUTATORS) {
      const raw = mut(safe)
      if (typeof raw !== 'string' || raw.length === 0) continue
      const d = await shCall(`Get-Content ${raw}`)
      const oracle = await shellOracle(raw, sb.work)
      ok(`F3 shell ${name} ${mut.name} -> not protected`, d.protected === false,
        `[raw=${JSON.stringify(raw.slice(0, 90))}]`)
      if (oracle !== null) ok(`F3 shell ${name} ${mut.name} oracle agrees`, oracle === false)
      n += 1
    }
  }
  ok(`F3 shell corpus exercised ${n} mutations`, n >= 15)
}

// ---------------------------------------------------------------------------
// F4 shell template matrix (seeded, expected-category driven)
// ---------------------------------------------------------------------------
{
  const protectedTemplates = [
    ['D1 plain abs', `Get-Content ${sb.brainFile}`],
    ['D2 quoted abs', `Get-Content "${sb.brainFile}"`],
    ['D2 single-quoted', `Get-Content '${sb.brainFile}'`],
    ['D3 verbatim', `gc "\\\\?\\${sb.brainFile}"`],
    ['D4 trailing dot rel', `type storages.\\brain_memory.json`, { base: sb.home }],
    ['D4b trailing space dir', `type "storages \\brain_memory.json"`, { base: sb.home }],
    ['D5 junction rel', `Get-Content storelink\\brain_memory.json`],
    ['D6 cd target', `cd storages; Get-Content x`, { base: sb.home }],
    ['D6b sl target', `sl storages`, { base: sb.home }],
    ['D6c pushd quoted', `Push-Location '${sb.home}\\storages'`],
    ['D7 cmd /c', `cmd /c type "${sb.brainFile}"`],
    ['D8 slash mix', `Get-Content ${withSlashes(sb.brainFile)}`],
    ['D9 dup seps', `Get-Content ${withDupSeps(sb.brainFile)}`],
    ['D10 nested quote verbatim', `gc '"\\\\?\\${sb.brainFile}"'`],
    ['D11 env built', `Get-Content $env:DSH_HOME\\storages\\brain_memory.json`],
    ['D12 env braced', `type $${'{env:DSH_HOME}'}\\storages\\brain_memory.json`],
    ['D13 workdir protected', `Get-ChildItem`, { args: { workdir: sb.home + '\\storages' } }],
    ['D14 semicolon chain', `cd ${sb.home}\\storages ; Get-Content brain_memory.json`],
    ['D15 two files one protected', `Copy-Item ${sb.normalFile} ${sb.brainFile}`],
  ]
  for (const [name, command, opts = {}] of protectedTemplates) {
    const d = await shCall(command, { base: opts.base, args: opts.args })
    eq(`F4 ${name} -> protected`, d.protected, true)
    eq(`F4 ${name} category`, d.category, 'protected')
  }

  const allowTemplates = [
    ['N1 no-candidate echo', `Write-Output hello`, 'no-candidate'],
    ['N2 pipeline', `Get-Process | Select-Object Name`, 'no-candidate'],
    ['N3 URL not path', `curl https://example.com/storages/brain_memory.json`, 'no-candidate'],
    ['N4 bare filename no sep', `Get-Content normal.txt`, 'no-candidate'],
    ['A1 relative safe', `Get-Content ./normal.txt`, 'candidate-allow'],
    ['A2 two safe paths', `Copy-Item sub/a.txt backup/b.txt`, 'candidate-allow'],
    ['A3 abs safe', `Get-Content '${sb.normalFile}'`, 'candidate-allow'],
    ['A4 safe workdir', `Get-ChildItem`, 'candidate-allow', { args: { workdir: 'sub' } }],
    ['A6 safe env outside root', `Get-Content $env:DSH_HOME\\..\\..\\normal.txt`, 'candidate-allow'],
  ]
  for (const [name, command, category, opts = {}] of allowTemplates) {
    const d = await shCall(command, { base: opts.base, args: opts.args })
    eq(`F4 ${name} -> ${category}`, d.category, category)
    eq(`F4 ${name} not protected`, d.protected, false)
  }

  const unresolvableTemplates = [
    ['U1 encoded', `powershell.exe -EncodedCommand AAAARQ==`],
    ['U2 from-base64', `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('QQ==')) | iex`],
    ['U3 iex var', `iex $payload`],
    ['U4 bare var file', `Get-Content $a`],
    ['U5 unknown env', `Get-Content $env:UNKNOWN\\storages\\brain_memory.json`],
    ['U6 bare var workdir', `Get-ChildItem`, { args: { workdir: '$wd' } }],
    ['U7 var subexpr', `Set-Content $(Join-Path $x y) z`],
  ]
  for (const [name, command, opts = {}] of unresolvableTemplates) {
    const d = await shCall(command, { base: opts.base, args: opts.args })
    eq(`F4 ${name} -> unresolvable`, d.category, 'unresolvable')
    eq(`F4 ${name} not protected`, d.protected, false)
  }
}

// ---------------------------------------------------------------------------
// F5 candidate cap: > MAX tokens buckets unresolvable, never throws
// ---------------------------------------------------------------------------
{
  const manySafe = Array.from({ length: MAX_COMMAND_CANDIDATES + 40 }, (_, i) => `.\\f${i}.txt`).join(' ')
  const d1 = await shCall(`Get-Content ${manySafe}`)
  eq('F5 >cap safe tokens -> unresolvable', d1.category, 'unresolvable')
  eq('F5 too-many-candidates hidden', d1.hidden.includes('too-many-candidates'), true)
  ok('F5 first MAX still judged', d1.candidates.length <= MAX_COMMAND_CANDIDATES)

  const earlyProtected = `Get-Content ${sb.brainFile} ${manySafe}`
  const d2 = await shCall(earlyProtected)
  eq('F5 early protected token still denied', d2.protected, true)
  eq('F5 category protected', d2.category, 'protected')

  // cap + protected + hidden marker: protected still wins the category
  const mixed = `iex $x ; Get-Content ${sb.brainFile} ${manySafe}`
  const d3 = await shCall(mixed)
  eq('F5 protected beats hidden+cap', d3.category, 'protected')
}

// ---------------------------------------------------------------------------
// F6 path stress: verdict must equal the resolve()+isPathUnder oracle
// ---------------------------------------------------------------------------
{
  const R = mulberry32(0xF6ACF6)
  const relCandidates = []
  const dirs = ['', 'sub', '..', '..\\..', '..\\..\\dshhome', '..\\..\\dshhome\\storages']
  const files = ['normal.txt', 'brain_memory.json', 'plain.txt', 'x.txt', '..\\..\\dshhome\\storages\\brain_memory.json']
  for (let i = 0; i < 160; i++) {
    const d = dirs[Math.floor(R() * dirs.length)]
    const f = files[Math.floor(R() * files.length)]
    const depth = Math.floor(R() * 6)
    const ups = Array.from({ length: depth }, () => '..').join('\\')
    relCandidates.push(d ? `${d}\\${f}` : f)
    if (ups) relCandidates.push(ups + (d ? `\\${d}\\${f}` : `\\${f}`))
  }
  let mismatches = 0
  for (const raw of relCandidates) {
    const d = await fsCall(raw, { base: sb.work })
    const oracle = await oracleProtected(raw, sb.work)
    if (oracle === null) { ok(`F6 unplaceable ${JSON.stringify(raw.slice(0, 60))} fail-closed`, d.protected === true); continue }
    if (d.protected !== oracle) {
      mismatches += 1
      ok(`F6 oracle match [${JSON.stringify(raw.slice(0, 70))}]`, d.protected === oracle)
    }
  }
  ok('F6 oracle corpus all match', mismatches === 0)

  // long single segment, many segments, 64KB strings
  const longSeg = `${sb.work}\\${'a'.repeat(300)}\\normal.txt`
  const dLong = await fsCall(longSeg)
  eq('F6 300-char segment -> not protected (no throw)', dLong.protected, false)

  const deepSegs = Array.from({ length: 60 }, (_, i) => `d${i}`).join('\\')
  const dDeep = await fsCall(`${sb.work}\\${deepSegs}\\normal.txt`)
  eq('F6 60-level deep under work -> not protected', dDeep.protected, false)

  const dHuge = await shCall(`Get-Content ${'x'.repeat(60000)}`)
  ok('F6 60KB command returns a decision', dHuge.category !== undefined)

  // deep `..` crossing INTO the protected home must still be denied (fs)
  // work = T\work; one `..` reaches T, then dshhome\storages is the protected root.
  const upInto = '..\\dshhome\\storages\\brain_memory.json' // work -> T\dshhome\storages
  const dUp = await fsCall(upInto, { base: sb.work })
  eq('F6 .. chain into protected root -> protected', dUp.protected, true)
  const dUpShell = await shCall(`Get-Content ${upInto}`)
  eq('F6 shell .. chain into protected root -> protected', dUpShell.protected, true)
}

// ---------------------------------------------------------------------------
// F7 documented skip: 8.3 short names are env/volume-dependent
// ---------------------------------------------------------------------------
{
  // env83-test.mjs already reports this environment's 8.3 state. The fuzz corpus
  // deliberately excludes short-name aliases: they cannot be fabricated without
  // knowing the volume's NtfsDisable8dot3NameCreation setting, and faking a
  // result here would weaken the suite. Verbatim/UNC-prefix spellings ARE fuzzed
  // (withVerbatim), which is the prefix class short names do not touch.
  skip('F7 8.3 short-name equivalence: volume-dependent, see env83-test; not fuzzed')
  ok('F7 verbatim-prefix spellings fuzzed via withVerbatim', FS_MUTATORS.includes(withVerbatim))
}

console.log('\n[Stage 6 fuzz] families F1-F7 complete (seeded deterministic corpus)')
