/**
 * Pure, zero-dependency SHELL command-path decision layer for confinement.
 *
 * Stage 5 companion to paths.ts. paths.ts guards STRUCTURED fs tools, whose
 * single path argument Node resolves. Shell tools (`pwsh`, `bash`) instead get
 * one free-form command string, so a protected path can appear anywhere:
 *   Get-Content $env:DSH_HOME\storages\brain_memory.json
 *   cmd /c type "C:\...\storages.\brain_memory.json"
 *   Set-Location C:\...\storages ; Get-Content x
 * This module extracts path candidates from the string and judges each with the
 * SAME realpath/identity predicate (isPathUnder) as the fs side.
 *
 * Posture is BEST-EFFORT, by explicit product decision (README: "fs 气密 /
 * shell 抬门槛 / 防误用不防对抗"):
 *   - A literal, extractable path (absolute, relative with separators, quoted,
 *     `\\?\`-prefixed, `$env:DSH_HOME`-built, trailing-dot/spelled) IS judged.
 *   - Content we cannot place WITHOUT EXECUTING THE COMMAND — encoded commands,
 *     FromBase64String, Invoke-Expression of a variable, an unknown env var, a
 *     bare-variable file argument, or anything after an untracked `cd` — is NOT
 *     guessed. It is allowed and audited as `unresolvable`; it is never silently
 *     bucketed as a benign no-candidate call.
 *   - We do NOT maintain shell cwd state. A `cd`/`Set-Location` TARGET is judged
 *     (so `cd storages` is denied outright), but later relative tokens are still
 *     resolved against the session workdir. `cd <protected>; gc file` where the
 *     cd itself is unrecognized is a documented bypass, not tracked.
 *
 * Windows channel asymmetry (paths-test Z5/Z6): PowerShell and cmd normalize a
 * trailing DOT/SPACE on a path component while Node fs does not. Extraction
 * therefore strips trailing dots/spaces per segment BEFORE isPathUnder, but
 * ONLY here — paths.ts deliberately keeps Node semantics to stay at parity with
 * stock dsh.
 *
 * Pure + zero-model: no cordis, no execution. Unit-tested in shell-test.mjs.
 * @module shell
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { isPathUnder } from './containment.ts'
import { stripVerbatimPrefix, type ProtectedRootResolver, type RootResolution } from './paths.ts'

/** Shell tools this module classifies. Kept in sync with paths.SHELL_TOOLS. */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set(['pwsh', 'bash'])

/** Argument field carrying the free-form command string (pwsh + bash schema). */
const COMMAND_PARAM = 'command'
/** Argument field optionally overriding the process working directory. */
const WORKDIR_PARAM = 'workdir'

/**
 * Max number of command-path candidates judged in one shell call. Each placed
 * candidate can cost a stat (identity fallback), so a pathological/huge command
 * must not fan out into thousands of stats inside the hook. Beyond the cap the
 * call is bucketed `unresolvable` with a `too-many-candidates` hidden label and
 * allowed (best-effort), though the first MAX candidates are still judged, so a
 * literal protected path early in the command is still vetoed. 256 is far above
 * any legitimate single command's path count.
 */
export const MAX_COMMAND_CANDIDATES = 256

/**
 * Read/write cmdlets whose file argument, if it is a bare variable/expression,
 * hides the real path. Conservative on purpose — only file-oriented verbs, so
 * `Write-Output $LASTEXITCODE` is not mislabeled.
 */
const FILE_CMDLET_RE
  = /(?:^|[\s;|&({])(?:get-content|gc|cat|type|set-content|sc|out-file|add-content|ac|new-item|ni|remove-item|ri|copy-item|cpi|move-item|mi|select-string|sls|test-path)\b/i

export type ShellCategory =
  /** No path-like token and no hidden-content marker (e.g. `echo hi`). */
  | 'no-candidate'
  /** At least one candidate placed; none lies under a protected root. */
  | 'candidate-allow'
  /** Content that can hide a path without executing; allowed + audited. */
  | 'unresolvable'
  /** At least one candidate (workdir/cd/path token) lies under a root. */
  | 'protected'

export interface ShellCandidate {
  /** Where the candidate came from, for audit/diagnostics. */
  source: 'workdir' | 'cd-target' | 'command-token'
  raw: string
  /** Absolute normalized candidate when it could be placed. */
  absolute?: string
  protected: boolean
  /** under-root | outside | error-fail-closed | unresolvable-hidden */
  reason: 'under-root' | 'outside' | 'error-fail-closed' | 'unresolvable-hidden'
}

export interface ShellDecision {
  tool: string
  /** True when any candidate is protected (the call is vetoed). */
  protected: boolean
  /** Always true for recognized shell tools, false for everything else. */
  evaluated: boolean
  category: ShellCategory
  candidates: ShellCandidate[]
  /** Machine labels for hidden-content signals (encoded/base64/variable...). */
  hidden: string[]
  rootSource: 'live' | 'snapshot'
}

const NO_DECISION = Symbol('no-shell-decision')

/** Frozen-tool guard that must never throw, mirroring paths.isFsTool. */
export function isShellTool(tool: unknown): boolean {
  return typeof tool === 'string' && SHELL_TOOL_NAMES.has(tool)
}

function dropOneQuoteLayer(s: string): string {
  if (s.length >= 2) {
    const a = s[0]
    const b = s[s.length - 1]
    if ((a === '"' || a === "'") && a === b) return s.slice(1, -1)
  }
  return s
}

/** unwrap quotes -> strip verbatim, to a fixpoint (handles nested quoting). */
function dequoteAndVerbatim(s: string): string {
  let cur = s.trim()
  for (let i = 0; i < 6; i += 1) {
    const next = stripVerbatimPrefix(dropOneQuoteLayer(cur)).trim()
    if (next === cur) break
    cur = next
  }
  return cur
}

/**
 * Windows shell normalization: PowerShell/cmd eat trailing dots and spaces on
 * EVERY path component. Applied only on win32. Returns segments joined with the
 * platform-neutral backslash form the caller will later resolve.
 */
function normalizeShellSegments(p: string, windows: boolean): string {
  if (!windows) return p
  // Split on both separators but remember whether it looked like a UNC/root path.
  const parts = p.split(/[\\/]+/).filter(part => part.length > 0)
  // Strip trailing dots/spaces, but NEVER on the navigational "." / ".."
  // segments — eating their dots would destroy relative traversal resolution.
  const stripped = parts.map(part =>
    (part === '.' || part === '..') ? part : part.replace(/[ .]+$/g, ''))
  // Preserve a leading slash/UNC so isAbsolute() still sees an absolute path.
  const prefix = p.startsWith('\\\\') ? '\\\\' : (p.startsWith('\\') || p.startsWith('/') ? '\\' : '')
  const driveish = /^[a-zA-Z]:$/.test(stripped[0] ?? '')
  if (driveish) return stripped.join('\\')
  return prefix + stripped.join('\\')
}

/** Detect content that can carry a path we cannot recover without executing. */
function hiddenMarkers(command: string): string[] {
  const found: string[] = []
  const c = command
  // powershell.exe -EncodedCommand / -enc / unique-prefix -e, as its OWN token
  // (a trailing-word boundary keeps -ErrorAction from matching "-e").
  if (/(?:^|[\s;|&])-+(?:encodedcommand|enc|e)(?=[\s"']|$)/i.test(c)) found.push('encoded-command')
  if (/FromBase64String/i.test(c)) found.push('from-base64')
  // Invoke-Expression / iex of ANYTHING can splice a hidden command/path.
  if (/(?:Invoke-Expression|\biex\b)/i.test(c)) found.push('invoke-expression')
  return found
}

/**
 * Expand the ONE env path we know authoritatively: DSH_HOME. Both PowerShell
 * ($env:DSH_HOME, ${env:DSH_HOME}) and bash ($DSH_HOME, ${DSH_HOME}) spellings.
 * Unknown env vars are left intact so the caller can flag them unresolvable.
 */
function expandKnownEnv(p: string, dshHome: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const home = esc(dshHome)
  let out = p
  out = out.replace(new RegExp(`\\$\\{?env:DSH_HOME\\}?`, 'gi'), home)
  out = out.replace(new RegExp(`\\$\\{DSH_HOME\\}`, 'g'), home)
  // Bare $DSH_HOME only when not immediately preceded by 'env:' (handled above).
  out = out.replace(new RegExp(`(?<!env:)\\$DSH_HOME`, 'g'), home)
  return out
}

interface RawToken { raw: string; source: ShellCandidate['source'] }

/** Pull candidate substrings out of a command string (no classification yet). */
function extractTokens(command: string): RawToken[] {
  const tokens: RawToken[] = []
  {
    const seen = new Set<string>()
    const push = (raw: string, source: RawToken['source']) => {
      const t = raw.trim()
      if (t.length === 0 || seen.has(t + source)) return
      seen.add(t + source)
      tokens.push({ raw: t, source })
    }

    // 1) cd-family targets (cd|sl|chdir|Set-Location|pushd|Push-Location),
    //    tolerating an optional -Path/-LiteralPath flag and one quote layer.
    const cdRe
      = /(?:^|[\s;|&({])(?:cd|sl|chdir|set-location|pushd|push-location)\b(?:\s+-(?:path|literalpath)\b)?(?:\s+("[^"]*"|'[^']*'|[^\s;|&()]+))/gi
    let m: RegExpExecArray | null
    // The capture group is mandatory in the match, but index access is typed
    // string|undefined under strict indexed access; '' is harmless to push().
    while ((m = cdRe.exec(command)) !== null) push(m[1] ?? '', 'cd-target')

    // 2) Anything containing a path separator (backslash or forward slash),
    //    after stripping quotes and common wrapping punctuation. This catches
    //    absolute/UNC/\\?\ paths, relative dirs, and 8.3-ish names that carry
    //    a subpath. URLs are explicitly not paths.
    const pathishRe = /[^\s"'`|;&()<>]+[\\/][^\s"'`|;&()<>]*/g
    while ((m = pathishRe.exec(command)) !== null) {
      let tok = m[0].replace(/^[<({\[]+/, '').replace(/[>)}\]]+$/, '')
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(tok)) continue // URL, not a fs path
      push(tok, 'command-token')
    }

    // 3) Quoted strings, even without a separator (cd "storages" is case 1,
    //    but a quoted bare dir passed to a file cmdlet has no separator).
    const quotedRe = /"([^"]*)"|'([^']*)'/g
    while ((m = quotedRe.exec(command)) !== null) push(m[1] ?? m[2] ?? '', 'command-token')
  }
  return tokens
}

/** File cmdlet receiving a bare variable/subexpression hides its real path. */
function bareVariableFileArgHidden(command: string): boolean {
  if (!FILE_CMDLET_RE.test(command)) return false
  // A file verb followed (anywhere in the statement) by a bare $var / $(...) /
  // @(...) argument that is not a literal path.
  return /(?:^|[\s;|&(])(?:\$\w+|\$\([^)]*\)|\@\([^)]*\))(?:[\s;|&)]|$)/.test(command)
}

/** Signature of the containment predicate; injectable only for error-path tests. */
export type ContainmentCheck = (
  candidate: string,
  root: string,
  caseSensitive: boolean,
) => Promise<boolean>

export interface ShellClassifyOptions {
  /** Absolute session working directory; relative candidates resolve here. */
  base?: string
  resolver: ProtectedRootResolver
  /** Force case sensitivity (tests); defaults to host convention. */
  caseSensitive?: boolean
  /** Force platform semantics (tests); defaults to process.platform. */
  platform?: NodeJS.Platform
  /**
   * Override the containment predicate. Production never sets this (defaults to
   * the vendored isPathUnder); it exists only to deterministically exercise the
   * stat-error fail-closed branch in zero-model tests.
   */
  underCheck?: ContainmentCheck
}

/**
 * Decide whether one model-facing shell call can touch a protected root.
 * Returns the internal NO_DECISION symbol for non-shell tools so the hook keeps
 * its single frozen-set lookup contract; callers check isShellTool first.
 */
export async function classifyShellCall(
  tool: string,
  args: unknown,
  options: ShellClassifyOptions,
): Promise<ShellDecision | typeof NO_DECISION> {
  if (!isShellTool(tool)) return NO_DECISION
  const resolution: RootResolution = options.resolver.current()
  const windows = (options.platform ?? process.platform) === 'win32'
  const caseSensitive = options.caseSensitive ?? (process.platform !== 'win32')
  const record = (args !== null && typeof args === 'object')
    ? (args as Record<string, unknown>)
    : {}

  const baseRaw = options.base
  const base = typeof baseRaw === 'string' && baseRaw.trim().length > 0 ? resolve(baseRaw) : undefined
  const dshHome = resolution.dshHome
  // Production uses the vendored predicate; tests may inject a throwing one.
  const underCheck: ContainmentCheck = options.underCheck ?? isPathUnder

  const candidates: ShellCandidate[] = []
  const command = typeof record[COMMAND_PARAM] === 'string' ? (record[COMMAND_PARAM] as string) : ''
  const hiddenList: string[] = hiddenMarkers(command)
  if (bareVariableFileArgHidden(command)) hiddenList.push('bare-variable-target')

  const judge = async (rawP: string, source: ShellCandidate['source']): Promise<void> => {
    let s = dequoteAndVerbatim(rawP)
    if (s.length === 0) return
    // A URL is not a filesystem path even though it contains "//".
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return
    s = expandKnownEnv(s, dshHome)
    // A residual $ (unknown env / variable / subexpression) cannot be placed
    // without executing — flag hidden, do not guess.
    if (s.includes('$')) {
      candidates.push({ source, raw: rawP, protected: false, reason: 'unresolvable-hidden' })
      if (!hiddenList.includes('unexpanded-variable')) hiddenList.push('unexpanded-variable')
      return
    }
    s = normalizeShellSegments(s, windows).trim()
    if (s.length === 0) return
    if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) {
      s = s === '~' ? homedir() : join(homedir(), s.slice(2))
    }
    let absolute: string
    if (isAbsolute(s)) {
      absolute = resolve(s)
    } else if (base !== undefined) {
      absolute = resolve(base, s)
    } else {
      // Relative candidate with no session cwd: cannot place.
      candidates.push({ source, raw: rawP, protected: false, reason: 'unresolvable-hidden' })
      if (!hiddenList.includes('no-base')) hiddenList.push('no-base')
      return
    }
    try {
      let under = false
      for (const root of resolution.roots) {
        if (await underCheck(absolute, root, caseSensitive)) { under = true; break }
      }
      candidates.push({
        source, raw: rawP, absolute,
        protected: under,
        reason: under ? 'under-root' : 'outside',
      })
    } catch {
      // A stat/I/O failure on a placed shell candidate (permission, a broken
      // UNC, a transient network root) must FAIL CLOSED, exactly like the fs
      // classifier. This is the alias/identity path where a throw is most
      // likely, so an open fallback would leak in precisely the guarded case.
      candidates.push({ source, raw: rawP, absolute, protected: true, reason: 'error-fail-closed' })
    }
  }

  // workdir first. A malformed/blank/non-string workdir is simply skipped — it
  // must never fail-closed the whole command (design decision, README).
  const wd = record[WORKDIR_PARAM]
  if (typeof wd === 'string' && wd.trim().length > 0) {
    await judge(wd, 'workdir')
  }

  if (command.trim().length > 0) {
    const tokens = extractTokens(command)
    // Cap fan-out: judge only the first MAX candidates; beyond that, bucket the
    // call unresolvable (best-effort) rather than issue thousands of stats. The
    // first MAX are still judged, so an early literal protected path still hits.
    if (tokens.length > MAX_COMMAND_CANDIDATES) {
      hiddenList.push('too-many-candidates')
    }
    for (const tok of tokens.slice(0, MAX_COMMAND_CANDIDATES)) {
      await judge(tok.raw, tok.source)
    }
  }
  // An empty/unusable command carries no placeable path; leave it to the
  // tool's own schema validation rather than vetoing on empty input.

  const protectedHits = candidates.filter(c => c.protected)
  const hiddenCandidates = candidates.filter(c => c.reason === 'unresolvable-hidden')
  const placed = candidates.filter(c => c.absolute !== undefined)

  let category: ShellCategory
  if (protectedHits.length > 0) {
    category = 'protected'
  } else if (hiddenList.length > 0 || hiddenCandidates.length > 0) {
    category = 'unresolvable'
  } else if (placed.length > 0) {
    category = 'candidate-allow'
  } else {
    category = 'no-candidate'
  }

  return {
    tool,
    protected: category === 'protected',
    evaluated: true,
    category,
    candidates,
    hidden: [...new Set(hiddenList)],
    rootSource: resolution.source,
  }
}
