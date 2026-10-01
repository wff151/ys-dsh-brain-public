/**
 * Pure, zero-dependency path-decision layer for memory confinement.
 *
 * This module knows nothing about cordis, tool hooks or the LLM. The future
 * `tools/execute` hook (stage 2) only feeds it:
 *   - the model-facing tool name + its already-parsed arguments object,
 *   - the session cwd (base for relative candidates),
 *   - a ProtectedRootResolver bound to the host's authoritative dshHome.
 * Keeping it pure makes every containment rule reproducible in zero-model unit
 * tests and free of host-load-order effects.
 *
 * Security posture:
 *   - Protected roots are re-resolved on EVERY decision (a profile may point
 *     dshHome elsewhere); a resolution failure falls back to the startup
 *     snapshot and stays fail-closed, it never opens up.
 *   - A candidate that cannot be placed or whose containment check errors is
 *     treated as protected (deny), because fs calls carry structured paths and
 *     the cost of a rare deny is lower than a memory leak.
 *   - The denial text returned to the model is one constant generic sentence
 *     that reveals neither the roots nor the check performed.
 * @module paths
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { isPathUnder } from './containment.ts'

/** Subdirectories under dshHome that hold durable memory and session artifacts. */
export const PROTECTED_SUBDIRS = ['storages', 'sessions'] as const

/** Shell tools handled in stage 3 (command path extraction). Listed now so the
 *  hook's tool taxonomy lives in one place; stage 1 only classifies fs tools.
 *
 *  Stage 5 requirement pinned by paths-test Z5/Z6: PowerShell and cmd normalize
 *  a trailing DOT on a path component (`storages.\x` reaches `storages\x`) even
 *  though Node fs does not. The shell candidate extractor MUST therefore strip
 *  trailing dots/spaces from every extracted segment BEFORE canonicalize/
 *  isPathUnder, or a literal `...\storages.\brain_memory.json` in a command
 *  bypasses the shell guard. The fs/Node side has no such hole (the path is
 *  simply unreachable there), so the vendored predicate is left unchanged. */
export const SHELL_TOOLS = new Set(['bash', 'pwsh'])

/**
 * The ONLY text returned to the model on a deny. Deliberately generic: it does
 * not name the tool, the path, the roots, or the rule, so it cannot be used to
 * infer where the protected storage lives.
 */
export const DENIAL_MESSAGE = 'Operation not permitted in this context.'

/** Model-facing fs tools and the argument field that carries their path(s). */
const FS_PATH_PARAMS: Readonly<Record<string, readonly string[]>> = {
  read: ['file_path'],
  read_image: ['file_path'],
  write: ['file_path'],
  edit: ['file_path'],
  str_replace_editor: ['path'],
  glob: ['path'],
  grep: ['path'],
}

export interface RootResolution {
  /** Absolute, normalized dshHome used for this decision. */
  dshHome: string
  /** Absolute protected roots (storages, sessions). */
  roots: string[]
  /** Whether roots came from live resolution or the startup snapshot. */
  source: 'live' | 'snapshot'
}

/** Expand a leading `~` the same way stock dsh home-paths does. */
export function expandHomePath(p: string, home: string = homedir()): string {
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2))
  return p
}

/**
 * Resolve dshHome with stock precedence: an explicit configured path wins,
 * then $DSH_HOME (non-blank), then ~/.dsh. Reimplemented with no dsh dependency
 * so the precedence is unit-testable with an injected env/home; synced against
 * @deepseek-ai/dsh-home-paths resolveDshHome (dsh-v0.1.6-alpha.2) by
 * tests/resolver-parity-test.mjs — run it after every dsh upgrade.
 *
 * Two intentional, test-pinned departures from upstream (upstream takes only
 * `(configured, env)` and selects configured with `??`, so a blank/whitespace
 * configured path resolves against cwd and `~` always uses os.homedir()):
 *   1. A blank/whitespace `configured` value is treated as unset. Our config
 *      schema defaults dshHome to '' (not undefined), and resolving '' to the
 *      process cwd would silently move the protected roots. Fail-safe here.
 *   2. `home` is injectable so precedence is deterministic in unit tests; in
 *      production the default is homedir(), identical to upstream.
 */
export function resolveDshHome(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const fromEnv = env.DSH_HOME
  const selected
    = configured !== undefined && configured.trim().length > 0
      ? configured
      : fromEnv !== undefined && fromEnv.trim().length > 0
        ? fromEnv
        : join(home, '.dsh')
  return resolve(expandHomePath(selected, home))
}

/** Absolute protected roots for one resolved dshHome. */
export function makeProtectedRoots(dshHome: string): string[] {
  return PROTECTED_SUBDIRS.map(sub => resolve(dshHome, sub))
}

/**
 * Binds an authoritative dshHome and hands out fresh roots per decision.
 *
 * `configured` is meant to come from the host (ctx.config), which a model
 * subprocess cannot mutate; env is only the secondary/tertiary fallback. The
 * startup snapshot is the fail-closed fallback if live resolution ever returns
 * blank or throws.
 */
export class ProtectedRootResolver {
  private readonly snapshot: RootResolution

  constructor(
    private readonly configured?: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly home: string = homedir(),
  ) {
    this.snapshot = ProtectedRootResolver.build(this.configured, this.env, this.home, 'snapshot')
  }

  private static build(
    configured: string | undefined,
    env: NodeJS.ProcessEnv,
    home: string,
    source: 'live' | 'snapshot',
  ): RootResolution {
    const dshHome = resolveDshHome(configured, env, home)
    return { dshHome, roots: makeProtectedRoots(dshHome), source }
  }

  /** The startup roots; exposed for diagnostics and the fail-closed fallback. */
  get snapshotResolution(): RootResolution {
    return this.snapshot
  }

  /** Resolve fresh on every call; on blank/error return the snapshot (never open). */
  current(): RootResolution {
    try {
      const live = ProtectedRootResolver.build(this.configured, this.env, this.home, 'live')
      const usable = live.dshHome.trim().length > 0
        && live.roots.length > 0
        && live.roots.every(r => r.trim().length > 0)
      return usable ? live : this.snapshot
    } catch {
      return this.snapshot
    }
  }
}

/**
 * Remove Windows verbatim/extended-length prefixes that defeat normalization.
 * `\\?\UNC\server\share\...` maps to the UNC `\\server\share\...` form; the plain
 * `\\?\` prefix is stripped. POSIX paths never start with these.
 */
export function stripVerbatimPrefix(p: string): string {
  const unc = '\\\\?\\UNC\\'
  if (p.startsWith(unc)) return '\\\\' + p.slice(unc.length)
  if (p.startsWith('\\\\?\\')) return p.slice(4)
  return p
}

/** Drop a single matching pair of surrounding single/double quotes. */
function unwrapQuotes(p: string): string {
  if (p.length >= 2) {
    const first = p[0]
    const last = p[p.length - 1]
    if ((first === '"' || first === "'") && first === last) return p.slice(1, -1)
  }
  return p
}

/**
 * Turn a raw tool path argument into an absolute, normalized path.
 * @param raw - the argument value (already parsed from JSON).
 * @param base - absolute session cwd for relative candidates.
 * @returns absolute path, or undefined when a relative candidate has no base
 *   (the caller treats undefined as fail-closed).
 */
export function canonicalizeCandidate(raw: string, base?: string): string | undefined {
  // unwrap -> strip -> trim to a FIXPOINT. A single strip-then-unwrap pass
  // misses a quote-wrapped verbatim prefix (`"\\?\C:\..."`): the strip stage
  // sees the opening quote and does nothing, and the prefix is only exposed
  // after unwrap. Alternating until the string stops changing also tolerates
  // nested quoting (`'"\\?\C:\..."'`). Bounded so a pathological input cannot
  // loop forever.
  let s = raw.trim()
  for (let i = 0; i < 6; i += 1) {
    const next = stripVerbatimPrefix(unwrapQuotes(s)).trim()
    if (next === s) break
    s = next
  }
  if (s.length === 0) return undefined
  const expanded = expandHomePath(s)
  if (isAbsolute(expanded)) return resolve(expanded)
  if (base === undefined || base.trim().length === 0) return undefined
  return resolve(base, expanded)
}

export type CandidateReason = 'under-root' | 'outside' | 'error-fail-closed' | 'unresolved-fail-closed'

export interface PathCandidate {
  tool: string
  param: string
  raw: string
  /** Absolute normalized candidate; absent when it could not be placed. */
  absolute?: string
  protected: boolean
  reason: CandidateReason
}

export interface FsDecision {
  tool: string
  /** True when any path candidate is protected or had to fail closed. */
  protected: boolean
  /** False for tools invoked without a path-bearing arg (e.g. grep, no `path`). */
  evaluated: boolean
  candidates: PathCandidate[]
  /** Which root resolution fed this decision (for audit). */
  rootSource: 'live' | 'snapshot'
}

async function evaluateCandidate(
  tool: string,
  param: string,
  raw: unknown,
  base: string | undefined,
  roots: readonly string[],
  caseSensitive: boolean,
): Promise<PathCandidate | undefined> {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  const absolute = canonicalizeCandidate(raw, base)
  if (absolute === undefined) {
    return { tool, param, raw, protected: true, reason: 'unresolved-fail-closed' }
  }
  try {
    for (const root of roots) {
      if (await isPathUnder(absolute, root, caseSensitive)) {
        return { tool, param, raw, absolute, protected: true, reason: 'under-root' }
      }
    }
    return { tool, param, raw, absolute, protected: false, reason: 'outside' }
  } catch {
    // A stat/I/O failure on a structured fs path: deny rather than guess.
    return { tool, param, raw, absolute, protected: true, reason: 'error-fail-closed' }
  }
}

export interface ClassifyOptions {
  /** Absolute session working directory; relative candidates resolve against it. */
  base?: string
  resolver: ProtectedRootResolver
  /** Defaults to the platform convention (false on win32). Override only for tests. */
  caseSensitive?: boolean
}

/**
 * Decide whether one model-facing fs tool call touches a protected root.
 * Tools not in the fs taxonomy get `evaluated:false, protected:false` (shell
 * tools are classified by a separate stage-3 routine).
 */
export async function classifyFsCall(
  tool: string,
  args: unknown,
  options: ClassifyOptions,
): Promise<FsDecision> {
  const params = typeof tool === 'string' ? FS_PATH_PARAMS[tool] : undefined
  const resolution = options.resolver.current()
  if (params === undefined) {
    return { tool, protected: false, evaluated: false, candidates: [], rootSource: resolution.source }
  }
  const caseSensitive = options.caseSensitive ?? (process.platform !== 'win32')
  const record = (args !== null && typeof args === 'object') ? (args as Record<string, unknown>) : {}
  const candidates: PathCandidate[] = []
  for (const param of params) {
    const verdict = await evaluateCandidate(tool, param, record[param], options.base, resolution.roots, caseSensitive)
    if (verdict) candidates.push(verdict)
  }
  const protectedCall = candidates.some(c => c.protected)
  return { tool, protected: protectedCall, evaluated: candidates.length > 0, candidates, rootSource: resolution.source }
}

/**
 * Convenience guard used by the future hook. Accepts ANY value and never
 * throws: a non-string (an exotic/hostile tool name) is reported as non-fs
 * without being coerced to a property key, so the non-fs pass-through path can
 * never blow up. Pinned by tests/invariant-test.mjs.
 */
export function isFsTool(tool: unknown): boolean {
  return typeof tool === 'string' && Object.prototype.hasOwnProperty.call(FS_PATH_PARAMS, tool)
}
