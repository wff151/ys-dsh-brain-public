/**
 * Pure types of the dsh-memory domain: memory entry schemas, projection-key
 * declarations, and payload types, free of host-side value imports.
 * @module dsh-brain-memory/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
export type { SessionId }

/** Branded memory record id. */
export type MemoryId = string & { readonly __brand: 'MemoryId' }

/** Branded evolution record id. */
export type RecordId = string & { readonly __brand: 'RecordId' }

/** Memory mode: daily (personal) or work (professional). */
export type MemoryMode = 'daily' | 'work'

/** Memory type classification. */
export type MemoryType = 'public' | 'short_term' | 'permanent' | 'portable_doc' | 'agent_evolution'

/** Agent evolution record type. */
export type EvolutionType = 'error-log' | 'proposal' | 'shadow-test' | 'rule' | 'reflection'

/** One public memory entry (long-term, dated, tagged). */
export interface PublicMemory {
  memory_id: MemoryId
  mode: MemoryMode
  date: string
  time: string
  title: string
  summary: string
  tags: string[]
  goal: string
  unresolved: string[]
  result: string
  source: string
}

/** One short-term memory item (weighted, decaying). */
export interface ShortTermItem {
  id: string
  mode: MemoryMode
  content: string
  tags: string[]
  weight: number
  accessCount: number
  createdAt: string
  lastAccess: string
}

/** Permanent user profile (user portrait). */
export interface PermanentProfile {
  attributes: Record<string, unknown>
  preferences: Record<string, unknown>
  skills: string[]
  relationships: string[]
}

/** One portable document (per-session working memory). */
export interface PortableDoc {
  sessionId: SessionId
  title: string
  mode: MemoryMode
  goal: string
  exchangeCount: number
  solvedProblems: string[]
  unresolvedProblems: string[]
  summary: string
  tags: string[]
  log: PortableDocLogEntry[]
}

export interface PortableDocLogEntry {
  turn: number
  user: string
  time: string
}

/** One agent evolution record (error log, proposal, rule, etc.). */
export interface AgentEvolutionRecord {
  type: EvolutionType
  id: string
  timestamp: string
  [key: string]: unknown
}

/** Memory domain global state. */
export interface MemoryDomainState {
  memoryCount: number
  lastWriteAt?: string
}

/** Triple retrieval result. */
export interface RetrievalResult {
  public: PublicMemory[]
  shortTerm: ShortTermItem[]
  profile: PermanentProfile | null
  portable: PortableDoc | null
}