/**
 * Auto-record: user exchanges landed into every memory tier at once.
 *
 * 现状（before）：index.ts 的 agent/inbox/claimed 钩子只写随身文档（portable
 * doc），对话内容只活在会话内。
 *
 * 双写（after）：一次用户消息同时落三层——
 *   1. 短期记忆（writeShortTerm）：当前工作记忆，重复内容自动提权；
 *   2. 长期公共记忆（recordPublicMemory）：跨会话可检索，带去重与长度门槛，
 *      避免每条消息都污染长期库；
 *   3. 随身文档（recordExchange）：保留原有行为，维持会话内目标/解决清单。
 *
 * 每层可用 autoRecord 配置独立开关，默认全开；内容各自截断，防止长消息
 * 撑爆短期窗口与长期库。
 * @module dsh-brain-memory/src/autorecord
 */

import type { MemoryStore } from './store.ts'
import type { PublicMemoryRecord } from './domain.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** 每层独立开关；默认全开。 */
export interface AutoRecordOptions {
  /** 写入短期记忆，默认 true。 */
  short?: boolean
  /** 写入长期公共记忆（带去重与门槛），默认 true。 */
  long?: boolean
  /** 写入随身文档（原有行为），默认 true。 */
  portable?: boolean
  /** 长期写入的最小文本长度（字符），默认 20。 */
  longMinChars?: number
  /**
   * Hook fired once for each newly written long-term memory (deduped writes do
   * not fire). Used to best-effort index the new memory into the semantic
   * vector store. Must never throw back into the recorder.
   */
  onLongRecord?: (entry: PublicMemoryRecord) => void
}

const SHORT_MAX_CHARS = 200
const LONG_MAX_CHARS = 500
const TITLE_MAX_CHARS = 40

/**
 * 把一次用户消息落入全部记忆层。
 * @param store - 打开的 memory store。
 * @param sessionId - 所属会话。
 * @param text - 用户消息文本（已去掉空白的原文）。
 * @param options - 分层开关与门槛。
 */
export async function autoRecordExchange(
  store: MemoryStore,
  sessionId: SessionId,
  text: string,
  options: AutoRecordOptions = {},
): Promise<{ short: boolean; long: boolean; portable: boolean }> {
  const short = options.short ?? true
  const long = options.long ?? true
  const portable = options.portable ?? true
  const longMinChars = options.longMinChars ?? 20

  const trimmed = text.trim()

  if (short && trimmed !== '') {
    await store.writeShortTerm('daily', trimmed.slice(0, SHORT_MAX_CHARS), ['auto-record'])
  }

  if (portable && trimmed !== '') {
    await store.recordExchange(sessionId, trimmed)
  }

  let longWritten = false
  if (long && trimmed.length >= longMinChars) {
    const title = trimmed.slice(0, TITLE_MAX_CHARS)
    const recent = store.listPublicMemories('daily')
    if (!recent.some(m => m.title === title)) {
      const entry = await store.recordPublicMemory({
        mode: 'daily',
        title,
        summary: trimmed.slice(0, LONG_MAX_CHARS),
        tags: ['auto-record'],
        source: 'auto-record',
      })
      longWritten = true
      if (options.onLongRecord !== undefined) {
        try {
          options.onLongRecord(entry)
        } catch {
          // Additive indexing must never break the recorded exchange.
        }
      }
    }
  }

  return { short, long: longWritten, portable }
}
