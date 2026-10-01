// Zero-model matrix for the Stage 5 shell command-path decision. Windows
// semantics are forced (platform:'win32', caseSensitive:false) for determinism;
// one POSIX pin at the end documents the trailing-dot channel asymmetry.
import { join } from 'node:path'
import { ok, eq, makeSandbox } from './_harness.mjs'
import { classifyShellCall, isShellTool } from '../src/shell.ts'
import { ProtectedRootResolver } from '../src/paths.ts'

const sb = makeSandbox()
try {
  const resolver = new ProtectedRootResolver(sb.home, {})
  const sh = (command, opts = {}) =>
    classifyShellCall('pwsh', { command, ...(opts.args ?? {}) }, {
      base: opts.base ?? sb.work,
      resolver,
      caseSensitive: false,
      platform: opts.platform ?? 'win32',
    })

  // ---------------- non-shell guard ----------------
  ok('isShellTool pwsh/bash', isShellTool('pwsh') && isShellTool('bash'))
  ok('isShellTool rejects read/undefined', !isShellTool('read') && !isShellTool(undefined))
  eq('non-shell returns the no-decision symbol',
    typeof await classifyShellCall('read', { file_path: 'x' }, { base: sb.work, resolver }), 'symbol')

  // ---------------- no-candidate (allow, ordinary) ----------------
  let d = await sh('Write-Output hello')
  eq('N1 plain output -> no-candidate', d.category, 'no-candidate')
  eq('N1 allowed', d.protected, false)

  d = await sh('Get-Process | Select-Object Name')
  eq('N2 pipeline, no path token -> no-candidate', d.category, 'no-candidate')

  d = await sh('curl https://example.com/storages/brain_memory.json')
  eq('N3 URL is not a fs path -> no-candidate', d.category, 'no-candidate')

  d = await sh('Get-Content normal.txt')
  eq('N4 bare relative filename has no separator -> no-candidate (cd bypass is documented)',
    d.category, 'no-candidate')

  // ---------------- candidate-allow (placed, none under root) ----------------
  d = await sh('Get-Content ./normal.txt')
  eq('A1 relative ./ safe -> candidate-allow', d.category, 'candidate-allow')
  eq('A1 not protected', d.protected, false)

  d = await sh(`Copy-Item sub/a.txt backup/b.txt`)
  eq('A2 two relative safe paths -> candidate-allow', d.category, 'candidate-allow')

  d = await sh(`Get-Content '${sb.normalFile}'`)
  eq('A3 absolute safe file -> candidate-allow', d.category, 'candidate-allow')

  // workdir semantics
  d = await sh('Get-ChildItem', { args: { workdir: 'sub' } })
  eq('A4 relative safe workdir -> candidate-allow', d.category, 'candidate-allow')
  ok('A4 workdir source tagged', d.candidates.some(c => c.source === 'workdir' && !c.protected))

  d = await sh('Get-Content ./normal.txt', { args: { workdir: 123 } })
  eq('A5 malformed numeric workdir is skipped, not fail-closed', d.category, 'candidate-allow')

  // ---------------- protected: literal command paths must be vetoed ----------------
  d = await sh('Get-Content $env:DSH_HOME\\storages\\brain_memory.json')
  eq('D1 $env:DSH_HOME literal build -> protected', d.protected, true)
  eq('D1 category', d.category, 'protected')

  d = await sh(`cmd /c type "${sb.brainFile}"`)
  eq('D2 quoted absolute via cmd type -> protected', d.protected, true)

  d = await sh(`gc "\\\\?\\${sb.brainFile}"`)
  eq('D3 \\\\?\\ verbatim in command -> protected', d.protected, true)

  d = await sh('type storages.\\brain_memory.json', { base: sb.home })
  eq('D4 trailing-dot relative (PowerShell-normalized) -> protected', d.protected, true)
  ok('D4 caught by a command-token candidate', d.candidates.some(c => c.protected && c.source === 'command-token'))

  d = await sh('Get-Content storelink\\brain_memory.json')
  eq('D5 workdir junction into storages -> protected (identity)', d.protected, true)

  d = await sh('cd storages; Get-Content x', { base: sb.home })
  eq('D6 bare cd target into storages -> protected', d.protected, true)
  ok('D6 denied on the cd-target candidate', d.candidates.some(c => c.source === 'cd-target' && c.protected))

  d = await sh(`Set-Location -Path "${sb.stor}"`)
  eq('D7 Set-Location -Path quoted absolute -> protected', d.protected, true)

  d = await sh('Get-Content $DSH_HOME/storages/brain_memory.json')
  eq('D8 bash-style $DSH_HOME spelling -> protected', d.protected, true)

  d = await sh('Set-Content $env:DSH_HOME\\storages\\pwn.txt -Value x')
  eq('D9 pwsh write via env build -> protected', d.protected, true)

  // workdir pointing at a protected root
  d = await sh('Get-ChildItem', { args: { workdir: sb.stor } })
  eq('D10 absolute workdir = storages -> protected', d.protected, true)
  ok('D10 workdir candidate under-root',
    d.candidates.some(c => c.source === 'workdir' && c.reason === 'under-root'))

  // D11 WHY: normalizeShellSegments strips trailing dots per segment, but it
  // must keep the navigational ".." segments verbatim. An earlier draft stripped
  // their dots too, erasing the upward traversal so this relative escape
  // resolved harmlessly inside workdir (a false allow). The case pins that
  // ".." survives normalization AND that a relative workdir resolves against the
  // session cwd, not against a chained "current" shell directory.
  d = await sh('Get-ChildItem', { base: sb.sub, args: { workdir: '../../dshhome/storages' } })
  eq('D11 relative workdir escaping into storages -> protected', d.protected, true)

  // ---------------- unresolvable (allowed + audited, NOT no-candidate) ----------------
  d = await sh('powershell -EncodedCommand SQBuAHYAbwBrAGUALQ')
  eq('U1 -EncodedCommand -> unresolvable + allowed', d.category, 'unresolvable')
  eq('U1 not vetoed (documented bypass)', d.protected, false)
  ok('U1 hidden encoded-command', d.hidden.includes('encoded-command'))

  d = await sh('powershell -e RwBlAHQ')
  eq('U2 -e unique prefix -> unresolvable', d.category, 'unresolvable')
  ok('U2 hidden encoded-command', d.hidden.includes('encoded-command'))

  d = await sh('powershell -ErrorAction Stop Get-Process')
  eq('U3 -ErrorAction must NOT match -e -> no-candidate', d.category, 'no-candidate')

  d = await sh("[System.Convert]::FromBase64String('AAA') | Invoke-Expression")
  eq('U4 FromBase64String -> unresolvable', d.category, 'unresolvable')
  ok('U4 hidden from-base64', d.hidden.includes('from-base64'))

  d = await sh('Invoke-Expression $c')
  eq('U5 iex variable -> unresolvable', d.category, 'unresolvable')
  ok('U5 hidden invoke-expression', d.hidden.includes('invoke-expression'))

  d = await sh('Get-Content $f')
  eq('U6 bare-variable file argument -> unresolvable', d.category, 'unresolvable')
  ok('U6 hidden bare-variable-target', d.hidden.includes('bare-variable-target'))

  d = await sh('gc $env:MYSTORE\\storages\\f.txt')
  eq('U7 unknown env var carrying a path -> unresolvable', d.category, 'unresolvable')
  ok('U7 hidden unexpanded-variable', d.hidden.includes('unexpanded-variable'))

  d = await sh('cd $loc; Get-Content x', { base: sb.home })
  eq('U8 cd into a variable -> unresolvable (no cwd tracking)', d.category, 'unresolvable')

  // ---------------- POSIX pin: no trailing-dot normalization off-Windows ----------------
  d = await sh('type storages./brain_memory.json', { base: sb.home, platform: 'linux' })
  eq('P-posix trailing-dot NOT normalized off-Windows -> not protected here',
    d.protected, false)

  // ---------------- fail-closed when the containment predicate throws ----------------
  // A non-ENOENT stat error (permission / broken UNC / transient network root)
  // used to be caught as reason=outside and the command allowed. It must now be
  // fail-closed. Inject a predicate that throws for a marker root and point a
  // resolver at that (nonexistent) home; a junction candidate makes the lexical
  // prefix miss, so the throwing identity path is actually reached.
  const { isPathUnder: realUnder } = await import('../src/containment.ts')
  const errHome = join(sb.T, 'ERR_HOME_FORCE_THROW')
  const errResolver = new ProtectedRootResolver(errHome, {})
  const throwing = async (candidate, root) => {
    if (String(root).includes('ERR_HOME_FORCE_THROW')) {
      const e = new Error('EACCES simulated')
      e.code = 'EACCES'
      throw e
    }
    return realUnder(candidate, root, false)
  }
  d = await classifyShellCall('pwsh',
    { command: 'Get-Content storelink\\brain_memory.json' },
    { base: sb.work, resolver: errResolver, caseSensitive: false, platform: 'win32', underCheck: throwing })
  eq('E1 stat error on identity path -> protected (fail-closed)', d.protected, true)
  eq('E1 category protected', d.category, 'protected')
  ok('E1 an error-fail-closed candidate recorded',
    d.candidates.some(c => c.reason === 'error-fail-closed' && c.protected))

  // ---------------- candidate fan-out cap ----------------
  const huge = Array.from({ length: 300 }, (_, i) => `Write-Output a${i}\\b${i}`).join(' ; ')
  d = await sh(huge)
  eq('E2 300-candidate command -> unresolvable, not judged one-by-one', d.category, 'unresolvable')
  eq('E2 allowed (best-effort)', d.protected, false)
  ok('E2 too-many-candidates label', d.hidden.includes('too-many-candidates'))
  ok('E2 only up to the cap of candidates judged', d.candidates.length <= 256)
} finally {
  sb.cleanup()
}
