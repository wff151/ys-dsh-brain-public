/**
 * The dsh-memory domain declaration: record schemas and the `defineDomain`
 * spec the memory store opens. The zod schemas are the durable-boundary
 * validators; the spec object is the single source of the domain's identity,
 * version, and layout.
 * @module dsh-brain-memory/src/domain
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryId, RecordId, SessionId } from './types.ts'

/** Memory id schema at the durable boundary; branding has no runtime representation. */
const memoryId = z.string().transform(value => value as MemoryId)

/** Evolution record id schema. */
const recordId = z.string().transform(value => value as RecordId)

/** Session id schema. */
const sessionId = z.string().transform(value => value as SessionId)

/** Memory mode: daily (personal) or work (professional). */
const memoryMode = z.enum(['daily', 'work'])

/** One public memory entry (long-term, dated, tagged). */
export const publicMemorySchema = z.object({
  memory_id: memoryId,
  mode: memoryMode,
  date: z.string(),
  time: z.string(),
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  goal: z.string().default(''),
  unresolved: z.array(z.string()).default([]),
  result: z.string().default(''),
  source: z.string().default('manual'),
})

/** One short-term memory item (weighted, decaying). */
export const shortTermItemSchema = z.object({
  id: z.string(),
  mode: memoryMode,
  content: z.string(),
  tags: z.array(z.string()).default([]),
  weight: z.number().default(1),
  accessCount: z.number().default(0),
  createdAt: z.string(),
  lastAccess: z.string(),
})

/** Permanent user profile (user portrait). */
export const permanentProfileSchema = z.object({
  attributes: z.record(z.string(), z.unknown()).default({}),
  preferences: z.record(z.string(), z.unknown()).default({}),
  skills: z.array(z.string()).default([]),
  relationships: z.array(z.string()).default([]),
})

/** One portable document (per-session working memory). */
export const portableDocSchema = z.object({
  sessionId,
  title: z.string(),
  mode: memoryMode,
  goal: z.string().default(''),
  exchangeCount: z.number().default(0),
  solvedProblems: z.array(z.string()).default([]),
  unresolvedProblems: z.array(z.string()).default([]),
  /** Milestone progress lines (the notebook running log of what got done). */
  progress: z.array(z.string()).default([]),
  /** Result summary once the task reaches a conclusion. */
  result: z.string().default(''),
  /** What to do next, as decided at the latest notebook update. */
  nextSteps: z.array(z.string()).default([]),
  summary: z.string().default(''),
  tags: z.array(z.string()).default([]),
  log: z.array(z.object({
    turn: z.number(),
    user: z.string(),
    time: z.string(),
  })).default([]),
})

/** One agent evolution record (error log, proposal, rule, etc.). */
export const agentEvolutionSchema = z.object({
  type: z.enum(['error-log', 'proposal', 'shadow-test', 'rule', 'reflection']),
  id: recordId,
  timestamp: z.string(),
}).passthrough()

/** Memory domain global state. */
export const memoryDomainStateSchema = z.object({
  memoryCount: z.number().default(0),
  lastWriteAt: z.string().optional(),
  /** Whether the memory snapshot is injected as prompt context (runtime toggle). */
  injectContext: z.boolean().default(true),
})

/** The memory domain spec: one table per memory subsystem plus a write counter. */
const initialGlobalState: MemoryDomainState = { memoryCount: 0, injectContext: true }

export const memoryDomainSpec = defineDomain({
  name: 'brain_memory',
  version: 1,
  global: {
    schema: memoryDomainStateSchema,
    initial: initialGlobalState,
  },
  tables: {
    public: domainTable<MemoryId, z.infer<typeof publicMemorySchema>>(publicMemorySchema),
    short: domainTable<string, z.infer<typeof shortTermItemSchema>>(shortTermItemSchema),
    permanent: domainTable<string, z.infer<typeof permanentProfileSchema>>(permanentProfileSchema),
    portable: domainTable<string, z.infer<typeof portableDocSchema>>(portableDocSchema),
    evolution: domainTable<RecordId, z.infer<typeof agentEvolutionSchema>>(agentEvolutionSchema),
  },
})

/**
 * One embedding vector indexed for a single public memory. Kept in a separate
 * domain so the semantic layer is purely additive: turning embeddings off (or
 * deleting the vector domain) never touches the durable memory records.
 */
export const vectorIndexSchema = z.object({
  /** Public memory id this vector was built from. */
  memory_id: memoryId,
  /** Embedding model that produced the vector (a model switch forces a rebuild). */
  model: z.string(),
  /** Content hash; when the source text changes the entry is re-embedded. */
  hash: z.string(),
  /** Dense embedding (dimension depends on the model). */
  vector: z.array(z.number()),
})

/** Dedicated vector domain — additive semantic index, isolated from memory. */
export const vectorDomainSpec = defineDomain({
  name: 'brain_memory_vectors',
  version: 1,
  tables: {
    vectors: domainTable<MemoryId, z.infer<typeof vectorIndexSchema>>(vectorIndexSchema),
  },
})

export type PublicMemoryRecord = z.infer<typeof publicMemorySchema>
export type ShortTermItemRecord = z.infer<typeof shortTermItemSchema>
export type PermanentProfileRecord = z.infer<typeof permanentProfileSchema>
export type PortableDocRecord = z.infer<typeof portableDocSchema>
export type AgentEvolutionRecord = z.infer<typeof agentEvolutionSchema>
export type MemoryDomainState = z.infer<typeof memoryDomainStateSchema>
export type VectorIndexRecord = z.infer<typeof vectorIndexSchema>
