/**
 * dsh-brain-confinement-gate: bundle-side memory gate (Stage 7).
 *
 * The main confinement plugin mounts standalone (inject ['tools']) for isolated
 * A/B testing, where no memory facility exists. In the production bundle the
 * guard must follow memory: memory enabled -> guard mounts, memory disabled ->
 * guard withdraws. cordis has no optional-inject syntax, so putting a hard
 * `brainMemory` requirement on the main plugin would silently deactivate it in
 * memory-less profiles (e.g. the independent confinement home). Instead this
 * thin gate declares `inject: ['tools', 'brainMemory']` and mounts the real
 * plugin under a child fiber only once the memory facility exists:
 *
 *   - memory disabled -> the `brainMemory` service is never provided -> this
 *     fiber's epoch stays INACTIVE -> no hook is ever mounted;
 *   - memory enabled  -> the gate activates -> mounts the main plugin; the
 *     child fiber shares the gate's lifetime;
 *   - memory removed later -> the service unregisters -> the gate's epoch
 *     flips to INACTIVE -> the fiber disposes -> the child confinement fiber
 *     unloads with it (hook unmounted). "memory 启用才挂，禁用即撤", driven by
 *     service availability, with no activation-order dependence.
 * @module dsh-brain-confinement-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  Config as ConfinementConfig,
  apply as confinementApply,
  inject as confinementInject,
  name as confinementName,
} from './index.ts'
import type { Config as ConfinementConfigType } from './index.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-brain-confinement-gate'

/** Requires the memory facility: without it the gate stays INACTIVE. */
export const inject = ['tools', 'brainMemory']

/** Same config surface as the main plugin (dshHome / logAllow), forwarded. */
export const Config = ConfinementConfig

/**
 * Mount the real confinement plugin under a child fiber once memory exists.
 * The child inherits this fiber's lifetime; unloading the gate unloads the
 * guard together with it.
 * @param ctx - registrant context.
 * @param config - validated plugin configuration, forwarded unchanged.
 */
export async function apply(ctx: Context, config: ConfinementConfigType): Promise<void> {
  const child = ctx.plugin(
    { name: confinementName, inject: confinementInject, apply: confinementApply },
    config,
  )
  await child
}
