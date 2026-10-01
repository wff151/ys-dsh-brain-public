/**
 * Internal confinement audit trail.
 *
 * The audit is OPT-IN: nothing is written unless the process sets
 * DSH_CONFINEMENT_AUDIT to an output file path. Production leaves it unset, so
 * there is zero disk write and zero extra surface. The e2e runner points it at a
 * directory OUTSIDE both the session workdir and DSH_HOME, so a model-facing
 * tool cannot read it back through the very surface this plugin guards.
 *
 * What is recorded (per guarded fs decision):
 *   - timestamp, tool name, verdict, whether the call was a nested/run_code one,
 *     which root resolution fed it, and the per-candidate reason codes.
 *   - a DETERMINISTIC short hash of each resolved absolute path candidate.
 * What is NEVER recorded: the raw path string or the raw arguments. The line is
 * a verdict index, not a map of the filesystem. A model that can read this file
 * (only possible when a tester exported the env var to a reachable place) learns
 * only hashes of paths IT ALREADY TRIED, plus verdicts — nothing new.
 *
 * Determinism contract (the runner recomputes the same value to correlate a
 * probe request with an audit row):
 *   hash = sha256( path.resolve(absolutePath) ).hex.slice(0, 12)
 * Both sides run the same Node on the same platform, so separators/casing
 * match; the 12-hex prefix is an audit correlation id, not a security boundary.
 *
 * Writes are fire-and-forget: a write failure (bad path, disk full) is swallowed
 * and must NEVER propagate into the tool hook — auditing must not change whether
 * a tool call is allowed or denied.
 * @module audit
 */

import { appendFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { FsDecision } from './paths.ts'
import type { ShellDecision } from './shell.ts'

/** Env var naming the audit JSONL file; absent/blank => audit disabled. */
export const AUDIT_ENV = 'DSH_CONFINEMENT_AUDIT'

export type AuditVerdict = 'allow' | 'deny' | 'fatal'

export interface AuditEntry {
  ts: number
  tool: string
  verdict: AuditVerdict
  /** True for a nested dispatch (e.g. inside run_code); confinement judges these too. */
  nested: boolean
  /** Live vs snapshot root resolution, when a decision exists. */
  rootSource?: 'live' | 'snapshot'
  /** One reason code per evaluated candidate, in argument order. */
  reasons?: string[]
  /** Deterministic 12-hex correlation id per resolvable candidate. */
  hashes?: string[]
  /**
   * Shell-only classification bucket, kept distinct from verdict so the three
   * allow shapes are separable post-hoc: no-candidate | candidate-allow |
   * unresolvable (protected maps to verdict=deny).
   */
  category?: string
  /** Shell-only labels for hidden-content signals (encoded/base64/variable). */
  hidden?: string[]
  /** Present only on fatal hook errors; a short error name, never a path. */
  error?: string
}

/** Deterministic correlation id for one absolute path; see module header. */
export function auditPathHash(absolutePath: string): string {
  return createHash('sha256').update(resolve(absolutePath)).digest('hex').slice(0, 12)
}

export class AuditSink {
  private readonly target: string | undefined

  constructor(target: string | undefined = process.env[AUDIT_ENV]) {
    this.target = target !== undefined && target.trim().length > 0 ? target : undefined
  }

  /** Whether any audit file was requested. */
  get enabled(): boolean {
    return this.target !== undefined
  }

  /** Append one already-built entry; never throws, never blocks the caller. */
  private append(entry: AuditEntry): void {
    if (this.target === undefined) return
    const line = JSON.stringify(entry) + '\n'
    // Intentionally not awaited and internally guarded: auditing is best-effort
    // and must never influence the guard decision or delay the tool result.
    void appendFile(this.target, line, 'utf8').catch(() => {})
  }

  /** Record one guarded fs decision. `logAllow` gates the higher-volume allows. */
  recordDecision(tool: string, decision: FsDecision, nested: boolean, logAllow: boolean): void {
    const verdict: AuditVerdict = decision.protected ? 'deny' : 'allow'
    if (verdict === 'allow' && !logAllow) return
    const reasons: string[] = []
    const hashes: string[] = []
    for (const c of decision.candidates) {
      reasons.push(c.reason)
      if (c.absolute !== undefined) hashes.push(auditPathHash(c.absolute))
    }
    this.append({
      ts: Date.now(),
      tool,
      verdict,
      nested,
      rootSource: decision.rootSource,
      ...(reasons.length > 0 ? { reasons } : {}),
      ...(hashes.length > 0 ? { hashes } : {}),
    })
  }

  /**
   * Record one guarded SHELL decision. The raw command string is NEVER stored:
   * only per-candidate `<source>:<reason>` codes, per-placed-candidate hashes,
   * and the category/hidden labels. `logAllow` gates allows as for fs.
   */
  recordShellDecision(tool: string, decision: ShellDecision, nested: boolean, logAllow: boolean): void {
    const verdict: AuditVerdict = decision.protected ? 'deny' : 'allow'
    if (verdict === 'allow' && !logAllow) return
    const reasons: string[] = []
    const hashes: string[] = []
    for (const c of decision.candidates) {
      reasons.push(`${c.source}:${c.reason}`)
      if (c.absolute !== undefined) hashes.push(auditPathHash(c.absolute))
    }
    this.append({
      ts: Date.now(),
      tool,
      verdict,
      nested,
      rootSource: decision.rootSource,
      category: decision.category,
      ...(decision.hidden.length > 0 ? { hidden: decision.hidden } : {}),
      ...(reasons.length > 0 ? { reasons } : {}),
      ...(hashes.length > 0 ? { hashes } : {}),
    })
  }

  /** Record a hook-internal failure (strict path denies; see hook). */
  recordFatal(tool: string, nested: boolean, error: unknown): void {
    const name = error instanceof Error ? error.name : typeof error
    this.append({ ts: Date.now(), tool, verdict: 'fatal', nested, error: name })
  }
}
