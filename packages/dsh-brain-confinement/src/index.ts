/**
 * dsh-brain-confinement: model-facing memory confinement for dsh 0.1.6.
 *
 * Mounts ONE outermost `tools/execute` listener (registered with
 * `{ prepend: true }`, so it runs ahead of timeout/checkpoint/fs-fence and a
 * protected call is vetoed before any of them). Two surfaces are guarded:
 *   - structured fs tools (read/read_image/write/edit/str_replace_editor/glob/
 *     grep): a single path argument judged by paths.classifyFsCall. This is the
 *     AIRTIGHT surface.
 *   - shell tools (pwsh/bash): a free-form command string whose literal path
 *     candidates are extracted and judged by shell.classifyShellCall. This is
 *     the BEST-EFFORT surface — encoded/variable/indirect content is allowed and
 *     audited as `unresolvable`, not guessed (README: "fs 气密 / shell 抬门槛").
 * Everything else passes straight through.
 *
 * Safety properties:
 *   - Every exec is judged, INCLUDING nested run_code dispatches; unlike the
 *     checkpoint policy there is NO `exec.parent` exemption.
 *   - A non-fs/non-shell tool does exactly TWO frozen-set lookups (`isFsTool`,
 *     `isShellTool`) then `next()`; both are typeof-guarded table membership and
 *     must never throw (pinned by tests/invariant-test.mjs), so a bug here can
 *     only ever fail the guarded surfaces, never the rest of the tool registry.
 *   - A classifier error on a guarded fs/shell call is STRICT: deny + audit
 *     `fatal`, never fail open. The cost is one possible false deny, not a leak.
 *   - The denial returns the registry's standard error shape and carries only a
 *     generic message; no internal code, root, path or tool name is revealed.
 *
 * Memory storage itself never goes through the model-facing fs/shell tools for
 * its own bookkeeping (it uses the storage-domain service), so this guard cannot
 * block the memory plugin's own reads/writes.
 * @module dsh-brain-confinement
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  DENIAL_MESSAGE,
  ProtectedRootResolver,
  classifyFsCall,
  isFsTool,
} from './paths.ts'
import { classifyShellCall, isShellTool } from './shell.ts'
import { AuditSink } from './audit.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-brain-confinement'

/** Only the tool registry is required to attach the around-dispatch hook. */
export const inject = ['tools']

export interface Config {
  /**
   * Authoritative dshHome override (highest precedence). Blank/absent lets the
   * resolver follow `$DSH_HOME`, then `~/.dsh`, exactly like stock dsh.
   */
  dshHome?: string
  /** Record allowed (non-denied) calls in the audit too. Default true. */
  logAllow?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  dshHome: z.string().default(''),
  logAllow: z.boolean().default(true),
})

/** Registry-standard error shape carrying only the generic denial message. */
function denialResult(): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: `Error: ${DENIAL_MESSAGE}` }],
    isError: true,
    error: { message: DENIAL_MESSAGE },
  }
}

/**
 * Mount the outermost confinement hook (fs airtight + shell best-effort).
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const configured
    = typeof config.dshHome === 'string' && config.dshHome.trim().length > 0
      ? config.dshHome
      : undefined
  const logAllow = config.logAllow !== false
  const resolver = new ProtectedRootResolver(configured)
  const sink = new AuditSink()

  ctx.logger?.info?.(`dsh-brain-confinement active (fs airtight + shell best-effort; audit ${sink.enabled ? 'on' : 'off'})`)

  ctx.on(
    'tools/execute',
    async (exec: ToolExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => {
      const tool = exec.name

      // INVARIANT — the sole path reached by everything not guarded. Both
      // lookups are frozen-set typeof-guarded membership tests that cannot
      // throw; invariant-test.mjs pins that for exotic inputs. Hence a fault
      // here can only affect the guarded fs/shell surfaces, never other tools.
      const fsTool = isFsTool(tool)
      if (!fsTool && !isShellTool(tool)) return next()

      // No parent exemption: nested run_code dispatches are judged identically.
      const nested = exec.parent !== undefined
      // Same cwd the tools themselves resolve relatives against
      // (tool-fs/session-cwd.ts): the session workspace, never process.cwd().
      const base = exec.agent?.session.header.cwd
      const baseOpt = base !== undefined ? { base } : {}

      try {
        if (fsTool) {
          const decision = await classifyFsCall(tool, exec.arguments, { resolver, ...baseOpt })
          sink.recordDecision(tool, decision, nested, logAllow)
          if (decision.protected) return denialResult() // veto: do not call next()
          return next()
        }

        const shellDecision = await classifyShellCall(tool, exec.arguments, { resolver, ...baseOpt })
        // isShellTool was true above, so this is always a real decision; the
        // symbol branch exists only to keep classifyShellCall total.
        if (typeof shellDecision === 'symbol') return next()
        sink.recordShellDecision(tool, shellDecision, nested, logAllow)
        if (shellDecision.protected) return denialResult() // veto literal protected path
        // unresolvable / candidate-allow / no-candidate all fall through —
        // shell is best-effort and never blocks on content it cannot parse.
        return next()
      } catch (error) {
        // STRICT fail-closed on either guarded surface; never fail open.
        sink.recordFatal(tool, nested, error)
        return denialResult()
      }
    },
    { prepend: true },
  )
}
