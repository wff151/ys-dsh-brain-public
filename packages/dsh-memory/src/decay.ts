/**
 * Short-term memory decay: time-exponential weight decay + archival.
 *
 * 移植自 memory-system 原型 decay.js（<repo>\memory-system\src\decay.js）：
 * weight = weight * exp(-lambda * daysSinceLastAccess)。超过 maxAgeDays 的条目
 * 直接归档；权重衰减到 threshold 以下的条目归档。默认归档行为是写入公共记忆
 * （软删除，不丢信息），与原型注释"归档到公共记忆"一致。
 *
 * 接入方式：dsh-memory 插件的 apply 里用 ctx.setInterval 周期触发
 * {@link runShortTermDecay}；也提供 brain_memory_decay 工具手动触发。
 * @module dsh-brain-memory/src/decay
 */

import type { ShortTermItemRecord } from './domain.ts'
import type { MemoryStore } from './store.ts'
import type { MemoryMode } from './types.ts'

/** 衰减速率（每天）。 */
const DEFAULT_LAMBDA = 0.05
/** 归档阈值：权重低于此值则归档。 */
const DEFAULT_THRESHOLD = 0.15
/** 最长保留天数（约一个季度）。 */
const DEFAULT_MAX_AGE_DAYS = 90

/** Decay 可调参数；全部可选，默认与原型一致。 */
export interface DecayOptions {
  /** 衰减速率（每天），默认 0.05。 */
  lambda?: number
  /** 归档阈值，默认 0.15。 */
  threshold?: number
  /** 最长保留天数，默认 90。 */
  maxAgeDays?: number
  /**
   * 归档回调，默认把条目写入公共记忆（软删除）。返回 Promise 时等待完成。
   */
  archive?: (item: ShortTermItemRecord, mode: MemoryMode) => void | Promise<void>
}

/** 一次衰减的结果。 */
export interface DecayResult {
  /** 被归档（从短期记忆中移除）的条目。 */
  archived: ShortTermItemRecord[]
  /** 衰减后仍保留的条目数。 */
  remaining: number
}

/** 两次衰减的总结果（daily + work）。 */
export interface DecaySummary {
  daily: DecayResult
  work: DecayResult
}

/** 距离今天的天数；无效时间按 0 处理（当天新条目不受衰减）。 */
function daysSince(iso: string | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return (Date.now() - t) / 86_400_000
}

/** 默认归档：把条目写入公共记忆，保留标签与内容，注明来源为短期记忆归档。 */
function defaultArchive(store: MemoryStore) {
  return async (item: ShortTermItemRecord, mode: MemoryMode): Promise<void> => {
    await store.recordPublicMemory({
      mode,
      title: `短期记忆归档：${item.content.slice(0, 24)}`,
      summary: item.content,
      tags: [...(item.tags ?? []), 'decay-archive'],
      source: 'decay',
    })
  }
}

/**
 * 对一个 mode 执行一次短期记忆衰减：
 * 1. 超过 maxAgeDays 的条目直接归档；
 * 2. 其余按 weight *= exp(-lambda * age) 衰减，低于 threshold 的归档；
 * 3. 有归档发生时用 replaceShortTerm 落盘剩余条目。
 * @param store - 打开的 memory store。
 * @param mode - daily 或 work。
 * @param options - 可调参数与归档回调。
 */
export async function decayShortTerm(
  store: MemoryStore,
  mode: MemoryMode,
  options: DecayOptions = {},
): Promise<DecayResult> {
  const lambda = options.lambda ?? DEFAULT_LAMBDA
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS
  const archive = options.archive ?? defaultArchive(store)

  const items = store.listShortTerm(mode)
  if (items.length === 0) return { archived: [], remaining: 0 }

  const archived: ShortTermItemRecord[] = []
  const remaining: ShortTermItemRecord[] = []

  for (const item of items) {
    const age = daysSince(item.lastAccess ?? item.createdAt)
    if (age > maxAgeDays) {
      archived.push(item)
      await archive(item, mode)
      continue
    }
    const next: ShortTermItemRecord = {
      ...item,
      weight: item.weight * Math.exp(-lambda * age),
    }
    if (next.weight < threshold) {
      archived.push(item)
      await archive(item, mode)
      continue
    }
    remaining.push(next)
  }

  if (archived.length > 0) {
    await store.replaceShortTerm(mode, remaining)
  }
  return { archived, remaining: remaining.length }
}

/**
 * 对 daily 与 work 两个 mode 各执行一次衰减。
 * @param store - 打开的 memory store。
 * @param options - 可调参数与归档回调。
 */
export async function runShortTermDecay(store: MemoryStore, options: DecayOptions = {}): Promise<DecaySummary> {
  const daily = await decayShortTerm(store, 'daily', options)
  const work = await decayShortTerm(store, 'work', options)
  return { daily, work }
}
