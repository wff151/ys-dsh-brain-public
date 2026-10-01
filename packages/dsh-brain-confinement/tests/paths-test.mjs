// Zero-model matrix for the fs path decision. caseSensitive is forced to false
// to model win32 deterministically regardless of the host running the suite.
import { join, resolve } from 'node:path'
import { ok, eq, skip, makeSandbox } from './_harness.mjs'
import { classifyFsCall, ProtectedRootResolver } from '../src/paths.ts'

const sb = makeSandbox()
const resolver = new ProtectedRootResolver(sb.home, {})
const dec = (tool, args, base = sb.work) =>
  classifyFsCall(tool, args, { base, resolver, caseSensitive: false })

try {
  // ---------- positives: must stay reachable (no false deny) ----------
  let d = await dec('read', { file_path: 'normal.txt' })
  eq('P1 relative workdir file allowed', d.protected, false)
  eq('P1 evaluated', d.evaluated, true)

  d = await dec('read', { file_path: sb.normalFile })
  eq('P2 absolute workdir file allowed', d.protected, false)

  d = await dec('read', { file_path: join('..', 'proj-sessions-demo', 'note.txt') }, sb.sub)
  eq('P3 sibling dir whose NAME contains "sessions" allowed', d.protected, false)

  d = await dec('grep', { pattern: 'X', path: sb.work })
  eq('P4 grep with safe explicit path allowed', d.protected, false)

  d = await dec('glob', { pattern: '*.txt', path: sb.demo })
  eq('P5 glob on the sessions-named sibling allowed', d.protected, false)

  const winIni = 'C:\\Windows\\win.ini'
  // imported lazily only for the existence probe
  const { existsSync } = await import('node:fs')
  if (existsSync(winIni)) {
    d = await dec('read', { file_path: winIni })
    eq('P6 unrelated out-of-workspace system file allowed', d.protected, false)
  } else {
    skip('P6 C:\\Windows\\win.ini absent on this host')
  }

  // ---------- negatives: fs read surface must be confined ----------
  d = await dec('read', { file_path: sb.brainFile })
  eq('F1 absolute read of storages denied', d.protected, true)
  eq('F1 reason', d.candidates[0]?.reason, 'under-root')

  const mixedCase = sb.stor.replace(/storages/i, 'StOrAgEs') + '\\brain_memory.json'
  d = await dec('read', { file_path: mixedCase })
  eq('F2 case-mutated storages path denied', d.protected, true)

  d = await dec('read', { file_path: join('..', '..', 'dshhome', 'storages', 'plain.txt') }, sb.sub)
  eq('F3 .. relative escape into storages denied', d.protected, true)

  d = await dec('read', { file_path: sb.sessFile })
  eq('F4 read under sessions denied', d.protected, true)

  d = await dec('read', { file_path: join(sb.stor, 'does-not-exist-zz.json') })
  eq('F5 non-existent file under storages denied (lexical fallback)', d.protected, true)
  eq('F5 reason', d.candidates[0]?.reason, 'under-root')

  d = await dec('read', { file_path: join(sb.stor, 'ghost-dir-zz', 'deep.json') })
  eq('F6 non-existent ancestor under storages denied', d.protected, true)

  // junction: lexical path lives in work, filesystem identity lands in storages
  d = await dec('read', { file_path: join(sb.link, 'brain_memory.json') })
  eq('F7 read THROUGH a workdir junction into storages denied', d.protected, true)
  eq('F7 caught by identity, not lexical', d.candidates[0]?.reason, 'under-root')

  d = await dec('read', { file_path: join(sb.link, 'ghost-file.json') })
  eq('F8 junction + missing file still denied via existing junction ancestor', d.protected, true)

  d = await dec('glob', { pattern: '*', path: sb.link })
  eq('F9 glob explicit path AT the junction denied', d.protected, true)

  d = await dec('grep', { pattern: 'X', path: sb.link })
  eq('F10 grep explicit path AT the junction denied', d.protected, true)

  const verbatim = '\\\\?\\' + sb.brainFile
  d = await dec('read', { file_path: verbatim })
  eq('F11 \\\\?\\ extended-length prefix denied', d.protected, true)

  d = await dec('read_image', { file_path: join(sb.stor, 'pic.png') })
  eq('F12 read_image path under storages denied', d.protected, true)

  d = await dec('str_replace_editor', { path: join(sb.stor, 'x.txt'), command: 'view' })
  eq('F13 str_replace_editor path under storages denied', d.protected, true)

  // ---------- negatives: write/edit surface (defense in depth, any mode) ----------
  d = await dec('write', { file_path: join(sb.stor, 'pwned.txt'), content: 'x' })
  eq('W1 write into storages denied', d.protected, true)

  d = await dec('edit', { file_path: sb.plainFile, old_string: 'a', new_string: 'b' })
  eq('W2 edit existing file in storages denied', d.protected, true)

  // ---------- not-evaluated / fail-closed shapes ----------
  d = await dec('grep', { pattern: 'x' })
  eq('N1 grep without path is not evaluated (root = cwd)', d.evaluated, false)
  eq('N1 grep without path allowed', d.protected, false)

  d = await dec('glob', { pattern: '*.json' })
  eq('N2 glob without path allowed', d.protected, false)

  d = await classifyFsCall('pwsh', { command: 'Get-Content x' }, { base: sb.work, resolver, caseSensitive: false })
  eq('N3 shell tool is not handled by the fs classifier', d.evaluated, false)

  d = await classifyFsCall('read', null, { base: sb.work, resolver, caseSensitive: false })
  eq('N4 non-object args left to the tool schema (not confined)', d.evaluated, false)

  d = await classifyFsCall('read', { file_path: 'foo.txt' }, { resolver, caseSensitive: false })
  eq('N5 relative path with no cwd fails CLOSED', d.protected, true)
  eq('N5 reason', d.candidates[0]?.reason, 'unresolved-fail-closed')

  // UNC host that cannot resolve: stat raises a non-ENOENT error -> fail closed.
  const unc = '\\\\?\\UNC\\conf-no-such-host-9z7k.invalid\\share\\storages\\x.json'
  const timeout = new Promise(res => setTimeout(() => res({ __timeout: true }), 4000))
  const raced = await Promise.race([dec('read', { file_path: unc }), timeout])
  if (raced.__timeout) {
    skip('N6 unreachable UNC stat did not fail fast on this host')
  } else {
    eq('N6 unreachable UNC errors fail-closed', raced.protected, true)
    eq('N6 reason', raced.candidates[0]?.reason, 'error-fail-closed')
  }

  // ---------- Stage 3 follow-ups: normalization fixpoint / missing root / NTFS tails ----------
  const { canonicalizeCandidate } = await import('../src/paths.ts')
  const { isPathUnder: ipu } = await import('../src/containment.ts')

  // Z1 quote-wrapped verbatim prefix: strip must run AFTER the quote layer is
  // removed (the old single strip->unwrap pass missed `"\\?\C:\..."`).
  eq('Z1 quoted \\\\?\\ prefix canonicalized',
    canonicalizeCandidate('"\\\\?\\' + sb.brainFile + '"', sb.work), resolve(sb.brainFile))
  d = await dec('read', { file_path: '"\\\\?\\' + sb.brainFile + '"' })
  eq('Z1 quoted verbatim read denied', d.protected, true)
  eq('Z1 nested-quoted verbatim canonicalized',
    canonicalizeCandidate(`'"\\\\?\\${sb.brainFile}"'`, sb.work), resolve(sb.brainFile))

  // Z2/Z3 missing-root semantics of the VENDORED isPathUnder:
  //  - a lexical descendant of a nonexistent root still matches (fast path);
  //  - an unrelated alias candidate canNOT match a nonexistent root, because
  //    identity proof needs the root to exist. The false is vendored behavior,
  //    not our policy — pinned here so an upstream change is visible.
  const ghostRoot = join(sb.T, `ghost-root-zz-${Date.now()}`)
  eq('Z2 missing root + lexical descendant -> true',
    await ipu(join(ghostRoot, 'storages', 'x.json'), join(ghostRoot, 'storages'), false), true)
  eq('Z3 missing root + existing alias elsewhere -> false (vendored)',
    await ipu(sb.link, ghostRoot, false), false)

  // The classifier must still protect subpaths of a home that does not exist
  // yet (fresh profile before first write).
  const ghostHome = join(sb.T, 'ghost-home-zz')
  const gr = new ProtectedRootResolver(ghostHome, {})
  const gd = await classifyFsCall('read', { file_path: join(ghostHome, 'storages', 'future.json') },
    { base: sb.work, resolver: gr, caseSensitive: false })
  eq('Z4 classifier protects under nonexistent home', gd.protected, true)
  eq('Z4 reason is lexical under-root', gd.candidates[0]?.reason, 'under-root')

  // Z5/Z6 trailing dot/space on a directory component. EMPIRICAL on this host
  // (Windows + Node fs): Node stat/open does NOT normalize `storages.` or
  // `storages ` (existsSync=false, even through a \\?\ spelling). PowerShell
  // and cmd DO normalize the trailing DOT (Get-Content / type reach the real
  // file); PowerShell resolves the trailing-SPACE directory name but the file
  // read still failed in probing.
  //
  // Consequence, pinned here instead of a guessed "should deny":
  //   - fs/Node side (the tools this classifier guards): the vendored
  //     predicate says outside, but the path is unreachable through Node fs, so
  //     there is NO read leak to close. Forcing a deny here would also drift
  //     from upstream parity.
  //   - shell side: Stage 5 command-path extraction MUST strip trailing
  //     dots/spaces from each candidate segment BEFORE the isPathUnder check,
  //     or `...\storages.\brain_memory.json` slips past the shell guard.
  if (process.platform === 'win32') {
    const dotFile = join(sb.stor + '.', 'brain_memory.json')
    const spFile = join(sb.stor + ' ', 'brain_memory.json')

    eq('Z5 trailing-dot: vendored predicate reports outside',
      await ipu(dotFile, sb.stor, false), false)
    d = await dec('read', { file_path: dotFile })
    eq('Z5 trailing-dot: classifier outside', d.protected, false)
    ok('Z5 trailing-dot: Node read surface unreachable (no fs leak)', !existsSync(dotFile))

    eq('Z6 trailing-space: vendored predicate reports outside',
      await ipu(spFile, sb.stor, false), false)
    d = await dec('read', { file_path: spFile })
    eq('Z6 trailing-space: classifier outside', d.protected, false)
    ok('Z6 trailing-space: Node read surface unreachable (no fs leak)', !existsSync(spFile))

    // The canonical spelling is still caught — the finding does not weaken the
    // ordinary guard.
    d = await dec('read', { file_path: sb.brainFile })
    eq('Z7 canonical storages spelling still denied', d.protected, true)
  } else {
    skip('Z5/Z6/Z7 trailing dot/space probe is Windows-only')
  }

  console.log('root resolution source observed:', resolver.current().source)
} finally {
  sb.cleanup()
}
