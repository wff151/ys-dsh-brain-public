/**
 * dsh-brain-dispatch: the single model-facing entry to every brain ability.
 *
 * Why this plugin exists: registering all 13 memory tools + the contradiction
 * tool put ~3k tokens of tool schemas into EVERY request, even for a trivial
 * one-shot task, and invited the model to "walk through" the whole catalogue.
 * This plugin registers exactly ONE tool, `brain`, with a compact action menu;
 * the full capability bodies stay on `ctx.brainMemory.capabilities` and are
 * invoked by short key. The model loads only the single ability it needs and
 * pays almost no schema tax on tasks that need none of them.
 *
 * Additive and reversible: disable this row (or set the memory plugin's
 * toolMode='native' + conduct standaloneTool=true) to restore the original
 * full `brain_memory_*` tool surface.
 * @module dsh-brain-dispatch
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: pulls in the `Context.brainMemory` module augmentation. Erased at
// bundle time, so the memory plugin code is not duplicated into this chunk.
import type {} from '../../dsh-memory/src/index.ts'
import type { BrainCapability } from '../../dsh-memory/src/tools.ts'
import { renderContradictionAnalysis } from '../../dsh-conduct/src/tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-brain-dispatch'

/**
 * Waits for the tool registry and the memory facility (which owns the
 * capability table). Activation is therefore service-availability driven: if
 * the memory plugin is absent, this plugin never mounts a broken tool.
 */
export const inject = ['tools', 'brainMemory']

/** Plugin configuration: no knobs today. */
export interface Config {}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({})

/** The contradiction ability lives in the conduct package (stateless). */
const CONTRADICTION_KEY = 'contradiction'

/** Build the compact, model-facing menu from the live capability table. */
function buildMenu(caps: Map<string, BrainCapability>): string {
  const lines: string[] = [
    '脑能力统一入口。默认不要调用——直接完成任务即可；只有确实需要某项能力时才调用，一次只传一个 action。params 是该动作的参数对象。',
  ]
  // Stable order: notebook first, then memory/growth/session/maintenance as
  // inserted by buildMemoryCapabilities, contradiction last.
  for (const cap of caps.values()) {
    lines.push(`- action="${cap.key}"：${cap.menu}`)
    lines.push(`  params：${cap.paramsHint}`)
  }
  lines.push(`- action="${CONTRADICTION_KEY}"：矛盾分析法。问题盘根错节、需要先排序主次矛盾再动手，或用户要决策建议时用。`)
  lines.push('  params：{question, facts?}')
  lines.push('简单、直接、一次能做完的任务，任何 action 都不要调用。')
  return lines.join('\n')
}

/** Short help returned when the model names an unknown action. */
function buildHelp(caps: Map<string, BrainCapability>, requested: unknown): string {
  const keys = [...caps.keys(), CONTRADICTION_KEY]
  return `未知 action：${String(requested ?? '(空)')}。可用动作：${keys.join('、')}。`
    + '若当前任务不需要这些能力，直接完成任务、不要再调用。'
}

/**
 * Mount the dispatcher: register the single `brain` tool.
 * @param ctx - registrant context carrying the tool registry + brainMemory.
 */
export function apply(ctx: Context): void {
  const menu = buildMenu(ctx.brainMemory.capabilities)
  ctx.tools.register(defineTool({
    name: 'brain',
    // The description carries the compact action menu: it is the ONLY thing the
    // model needs to pick an action. One menu (~14 short lines) replaces the 13
    // full tool schemas that previously rode on every request.
    description: menu,
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: '要使用的能力名，见上面说明（如 note / search / resume / failure_check / contradiction）。',
      },
      params: {
        type: 'json',
        description: '该 action 的参数对象；无参数的动作传 {}。字段见各 action 的 params 说明。',
      },
    },
    output: {
      schema: { type: 'string' as const },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    execute: async (args, exec) => {
      const action = String(args?.action ?? '')
      const params: Record<string, unknown> = (args?.params !== null && typeof args?.params === 'object'
        ? args.params
        : {}) as Record<string, unknown>
      const caps = ctx.brainMemory.capabilities

      if (action === CONTRADICTION_KEY) {
        return renderContradictionAnalysis(
          String(params.question ?? ''),
          typeof params.facts === 'string' ? params.facts : undefined,
        )
      }

      const cap = caps.get(action)
      if (cap === undefined) return buildHelp(caps, action)
      return cap.run(params, exec)
    },
    presentCall: args => ({
      card: 'generic',
      title: `脑能力 · ${String(args?.action ?? '?')}`,
      kind: 'other',
      rawInput: String(args?.action ?? 'brain'),
    }),
  }))

  // Surface the assembled menu in the loader log for diagnostics (not model-facing).
  ctx.logger.info(`brain-dispatch: registered single brain tool with ${ctx.brainMemory.capabilities.size + 1} actions`)
}
