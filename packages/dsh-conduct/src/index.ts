/**
 * dsh-conduct plugin entry: injects the conduct layer (道天地将法 + dialectical
 * methods) as the top prompt context and registers the contradiction-analysis
 * guidance tool.
 *
 * This is the ③ 执行哲学 (内核) subsystem of the design draft: a pure
 * prompt-context + tool contribution with no durable state of its own. It sits
 * in the shared base plane so every profile (web / headless) inherits the same
 * value layer, above the memory snapshot the dsh-memory plugin injects.
 * @module @deepseek-ai/dsh-conduct
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { registerConductContext, registerAttentionContext } from './conduct.ts'
import { registerConductTools } from './tools.ts'

export { CONDUCT_TEXT, CONDUCT_CONTEXT_NAME, CONDUCT_CONTEXT_ORDER } from './conduct.ts'
export { ATTENTION_TEXT, ATTENTION_CONTEXT_NAME, ATTENTION_CONTEXT_ORDER } from './conduct.ts'
export { renderContradictionAnalysis } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-brain-conduct'

/** The tools registry must exist before the tool rows can register. */
export const inject = ['tools']

/** Plugin configuration. */
export interface Config {
  /**
   * Whether the standalone `brain_analyze_contradiction` tool is registered.
   * Default false: under the dsh-brain-dispatch dispatcher the ability is
   * reached as `brain` action=contradiction, so no extra tool schema is loaded.
   * Set true only when running memory in native tool mode (full tool surface).
   */
  standaloneTool?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  standaloneTool: z.boolean().default(false),
})

/**
 * Mount the conduct plugin: register the prompt context and, only when
 * explicitly opted in, the standalone guidance tool.
 * @param ctx - registrant context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  registerConductContext(ctx)
  registerAttentionContext(ctx)
  if (config.standaloneTool === true) {
    registerConductTools(ctx)
  }
}
