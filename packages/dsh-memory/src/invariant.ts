/** Package-owned memory domain invariants. @module dsh-brain-memory/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'

const PACKAGE_NAME = 'dsh-brain-memory'
const DOMAIN_NAME = 'brain_memory'

/** Cordis companion plugin name. */
export const name = 'dsh-brain-memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate that the memory domain is open and its global state is consistent. */
function validateMemoryDomain(ctx: Context, fail: InvariantFailure): void {
  const domain = ctx.storage.form('domain').get(DOMAIN_NAME)
  if (domain === undefined) {
    fail(`memory domain '${DOMAIN_NAME}' is not open`)
  }
  const global = domain!.global.get() as { memoryCount?: number }
  if (typeof global.memoryCount !== 'number' || global.memoryCount < 0) {
    fail(`memory domain '${DOMAIN_NAME}' has invalid memoryCount: ${String(global.memoryCount)}`)
  }
}

/** Validate one domain change event for the memory domain. */
function validateChange(change: DomainChanged, fail: InvariantFailure): void {
  if (change.domain !== DOMAIN_NAME) return
  if (change.operation === 'put' && change.table === 'public') {
    const record = change.value as Record<string, unknown>
    if (typeof record.memory_id !== 'string') {
      fail(`public memory record missing 'memory_id' at key '${change.key}'`)
    }
    if (record.mode !== 'daily' && record.mode !== 'work') {
      fail(`public memory record '${record.memory_id}' has invalid mode: ${String(record.mode)}`)
    }
  }
}

/** Install startup validation and change-event monitoring for the memory domain. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateMemoryDomain(ctx, fail)
  ctx.on('domain/changed', (change: DomainChanged) => {
    validateChange(change, fail)
  }, { global: true })
}, { inject: ['storage'] })

/**
 * Register the memory domain invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))