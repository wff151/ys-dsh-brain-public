/**
 * dsh-memory plugin entry: opens the memory domain, publishes the `memory`
 * service, registers the model-facing memory tools, and injects the memory
 * snapshot as dynamic prompt context.
 *
 * The store is opened during `apply` and closed via `ctx.effect` disposer, so
 * a plugin unmount drains queued writes.
 * @module dsh-brain-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from './store.ts'
import { registerMemoryTools, buildMemoryCapabilities, type BrainCapability } from './tools.ts'
import { registerMemoryContext } from './context.ts'
import { runShortTermDecay } from './decay.ts'
import { autoRecordExchange } from './autorecord.ts'
import { runPeriodicReflection } from './reflection.ts'
import { createEmbeddingClient } from './embedding.ts'
import { VectorStore } from './vector-store.ts'
import { SemanticService } from './semantic.ts'

// The pure payload outlet (./types.ts, ONE home of the memory types) re-exported
// onto the package root keeps the module edge in the emitted index.d.ts, so
// aggregate programs consuming the declarations still receive the types.
export type * from './types.ts'
export {
  publicMemorySchema,
  shortTermItemSchema,
  permanentProfileSchema,
  portableDocSchema,
  agentEvolutionSchema,
  memoryDomainStateSchema,
  memoryDomainSpec,
} from './domain.ts'
export type {
  PublicMemoryRecord,
  ShortTermItemRecord,
  PermanentProfileRecord,
  PortableDocRecord,
} from './domain.ts'
export { MemoryStore } from './store.ts'
export { searchPublicMemory, searchShortTerm, renderRetrievedContext } from './retrieval.ts'
export { renderMemoryContext, renderMemoryHint } from './context.ts'
export {
  docLastActiveMs,
  isResumable,
  selectResumable,
  findResumableSessions,
  renderResumeBrief,
  renderResumeHint,
  RESUME_GUIDANCE,
} from './resume.ts'
export type { ResumableSession, ResumeSelectOptions } from './resume.ts'
export { decayShortTerm, runShortTermDecay } from './decay.ts'
export type { DecayOptions, DecayResult, DecaySummary } from './decay.ts'
export { autoRecordExchange } from './autorecord.ts'
export type { AutoRecordOptions } from './autorecord.ts'
export { renderShortTermProjection, withIdempotency, idempotencyKeyOf } from './state.ts'
export { countErrorFingerprints, maybeCreateProposals } from './evolution.ts'
export type { EscalationOptions, EscalationResult } from './evolution.ts'
export {
  REFLECTION_TEMPLATE,
  collectReflectionMaterial,
  renderReflectionObservation,
  runPeriodicReflection,
} from './reflection.ts'
export type { ReflectionMaterial, ReflectionOptions, PeriodicReflectionResult } from './reflection.ts'
export { createEmbeddingClient, cosineSimilarity, contentHash } from './embedding.ts'
export type { EmbeddingClient, EmbeddingClientConfig } from './embedding.ts'
export { VectorStore } from './vector-store.ts'
export { SemanticService, memoryEmbeddingText } from './semantic.ts'
export type { SemanticOptions, SyncResult } from './semantic.ts'
export { vectorDomainSpec, vectorIndexSchema } from './domain.ts'
export type { VectorIndexRecord } from './domain.ts'
export {
  searchPublicMemoryVector,
  renderRetrievedContextAsync,
} from './retrieval.ts'
export {
  BUDGET_PROFILES,
  inferImportance,
  estimateTokens,
  resolveBudget,
  searchWithBudget,
  renderBudgetedContext,
  renderRetrievedContextBudgeted,
} from './budget.ts'
export type {
  Importance,
  ImportanceInput,
  SignalGates,
  RetrievalBudget,
  BudgetPass,
  BudgetSearchResult,
  BudgetSearchOptions,
} from './budget.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    brainMemory: MemoryFacility
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-brain-memory'

/** Services required before the plugin can activate. */
export const inject = ['storageDomain', 'tools']

/** Plugin configuration. */
export interface Config {
  /**
   * How brain abilities are exposed to the model.
   * - `dispatcher` (default): no `brain_memory_*` tools are registered. The
   *   separate dsh-brain-dispatch plugin exposes a single lightweight `brain`
   *   tool and routes `action` → capability, collapsing the per-request tool
   *   schema tax. Capabilities still live on `ctx.brainMemory.capabilities`.
   * - `native`: register every ability as its own full-schema `brain_memory_*`
   *   tool (the original surface; use as the opt-in fallback).
   */
  toolMode?: 'dispatcher' | 'native'
  /** Whether the memory snapshot is injected as a dynamic prompt context. */
  injectContext?: boolean
  /**
   * Brand-new session resume nudge (semantic checkpoint across sessions):
   * when the current session has no portable doc but other sessions still
   * have unresolved tasks, inject one non-interrupting line pointing at the
   * read-only `brain_memory_resume` tool. Guides; never auto-starts or replays.
   * Default true; set false to silence.
   */
  resumeHint?: boolean
  /**
   * Short-term memory decay interval in hours (0 disables the periodic pass).
   * Default 6. The decay itself lives in ./decay.ts (port of the memory-system
   * prototype decay.js): time-exponential weight decay + archival to public
   * memory.
   */
  decayIntervalHours?: number
  /**
   * Auto-record layer switches. Every user exchange lands into short-term,
   * long-term public memory (deduped) and the session portable doc. Defaults
   * to all on; set a layer to false to stop writing it.
   */
  autoRecord?: {
    short?: boolean
    long?: boolean
    portable?: boolean
  }
  /**
   * Periodic reflection interval in hours (0 disables the scheduled loop).
   * Default 24 (one reflection/day). The loop lives in ./reflection.ts: pull
   * recent memories / errors / proposals, distill deterministic patterns, and
   * append a periodic reflection record (idempotent per day).
   */
  reflectionIntervalHours?: number
  /**
   * Real vector semantic retrieval (OpenAI-compatible /embeddings). When
   * enabled, public memories are embedded and ranked by cosine similarity; if
   * the endpoint is absent or fails, retrieval transparently falls back to the
   * keyword/bigram path. Vectors live in a separate additive domain.
   */
  embedding?: {
    enabled?: boolean
    /** API base including `/v1` (LM Studio default 1234; llama.cpp also works). */
    baseURL?: string
    model?: string
    apiKey?: string
    timeoutMs?: number
    /** Minimum cosine to count as a hit. */
    minScore?: number
    /** Texts per embedding request while building the index. */
    batchSize?: number
  }
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  toolMode: z.string().default('dispatcher'),
  injectContext: z.boolean().default(true),
  resumeHint: z.boolean().default(true),
  decayIntervalHours: z.number().default(6),
  autoRecord: z.object({
    short: z.boolean().default(true),
    long: z.boolean().default(true),
    // The notebook is now model-updated at key moments (brain action=note),
    // not appended on every user message. Opt back in with portable: true.
    portable: z.boolean().default(false),
  }),
  reflectionIntervalHours: z.number().default(24),
  embedding: z.object({
    enabled: z.boolean().default(true),
    baseURL: z.string().default('http://127.0.0.1:1234/v1'),
    model: z.string().default('text-embedding-nomic-embed-text-v1.5'),
    apiKey: z.string().default(''),
    timeoutMs: z.number().default(5000),
    minScore: z.number().default(0.3),
    batchSize: z.number().default(16),
  }),
})

/** Resolved defaults. */
export interface ResolvedConfig {
  toolMode: 'dispatcher' | 'native'
  injectContext: boolean
  resumeHint: boolean
  decayIntervalHours: number
  autoRecord: { short: boolean; long: boolean; portable: boolean }
  reflectionIntervalHours: number
  embedding: {
    enabled: boolean
    baseURL: string
    model: string
    apiKey: string
    timeoutMs: number
    minScore: number
    batchSize: number
  }
}

/** The `ctx.brainMemory` service: a thin facade over the opened memory store. */
export class MemoryFacility extends Service {
  /** The opened memory store; `undefined` before init completes. */
  opened?: MemoryStore

  /**
   * Brain capabilities indexed by short dispatcher key. Populated during
   * `apply`; the dsh-brain-dispatch plugin routes the single `brain` tool to
   * these. Always built, even in native tool mode.
   */
  capabilities: Map<string, BrainCapability> = new Map()

  constructor(ctx: Context) {
    super(ctx, 'brainMemory')
  }

  /** The opened memory store; `undefined` before init completes. */
  get store(): MemoryStore | undefined {
    return this.opened
  }
}

/**
 * Mount the memory plugin: open the domain, provide the service, register
 * tools and prompt context.
 * @param ctx - registrant context.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved: ResolvedConfig = {
    toolMode: config.toolMode === 'native' ? 'native' : 'dispatcher',
    injectContext: config.injectContext ?? true,
    resumeHint: config.resumeHint ?? true,
    decayIntervalHours: config.decayIntervalHours ?? 6,
    autoRecord: {
      short: config.autoRecord?.short ?? true,
      long: config.autoRecord?.long ?? true,
      portable: config.autoRecord?.portable ?? false,
    },
    reflectionIntervalHours: config.reflectionIntervalHours ?? 24,
    embedding: {
      enabled: config.embedding?.enabled ?? true,
      baseURL: config.embedding?.baseURL ?? 'http://127.0.0.1:1234/v1',
      model: config.embedding?.model ?? 'text-embedding-nomic-embed-text-v1.5',
      apiKey: config.embedding?.apiKey ?? '',
      timeoutMs: config.embedding?.timeoutMs ?? 5000,
      minScore: config.embedding?.minScore ?? 0.3,
      batchSize: config.embedding?.batchSize ?? 16,
    },
  }

  const { MemoryStore } = await import('./store.ts')
  const store = await MemoryStore.open(ctx)
  ctx.effect(() => () => store.close(), 'memory.domainClose')

  // Additive real-vector semantic layer. Opens a separate vector domain and a
  // background probe/first-sync; retrieval and tools receive the service and
  // transparently fall back to keywords whenever it is absent or unhealthy.
  let semantic: SemanticService | undefined
  if (resolved.embedding.enabled) {
    const vectors = await VectorStore.open(ctx)
    ctx.effect(() => () => { void vectors.close() }, 'memory.vectorDomainClose')
    const client = createEmbeddingClient({
      baseURL: resolved.embedding.baseURL,
      model: resolved.embedding.model,
      ...(resolved.embedding.apiKey ? { apiKey: resolved.embedding.apiKey } : {}),
      timeoutMs: resolved.embedding.timeoutMs,
    })
    semantic = new SemanticService(client, vectors, {
      minScore: resolved.embedding.minScore,
      batchSize: resolved.embedding.batchSize,
    })

    // Probe + first index build off the critical path so plugin mount never
    // blocks on the embedding server. A failed probe just leaves keywords on.
    let bootCancelled = false
    ctx.effect(() => () => { bootCancelled = true }, 'memory.semanticBoot')
    setTimeout(() => {
      void (async () => {
        if (bootCancelled || semantic === undefined) return
        if (await semantic.probe()) {
          const r = await semantic.syncIndex(store)
          ctx.logger.info(`memory: semantic index ready (${r.model}, indexed ${r.indexed}, skipped ${r.skipped}, failed ${r.failed}, pruned ${r.pruned})`)
        } else {
          ctx.logger.info('memory: embedding endpoint unavailable; semantic search using keyword fallback')
        }
      })().catch((error: unknown) => {
        ctx.logger.warn(`memory: semantic boot failed: ${String(error)}`)
      })
    }, 1500)
  }

  // The Service constructor registers `ctx.brainMemory` in the current fiber.
  const facility = new MemoryFacility(ctx)
  facility.opened = store
  facility.capabilities = buildMemoryCapabilities(store, semantic)

  // dispatcher mode (default): register NO per-ability tools — the separate
  // dsh-brain-dispatch plugin serves one lightweight `brain` entry, keeping the
  // full schemas out of every request. native mode restores the original
  // brain_memory_* tool surface as an opt-in fallback.
  if (resolved.toolMode === 'native') {
    registerMemoryTools(ctx, store, semantic)
  } else {
    ctx.logger.info('memory: dispatcher mode — abilities served through the single brain tool')
  }

  // Periodic short-term memory decay (port of decay.js): weight decays
  // exponentially with days since last access; over-age / under-threshold
  // items are archived into public memory. The timer is disposed with the
  // plugin via ctx.effect.
  const decayIntervalMs = resolved.decayIntervalHours * 3_600_000
  if (decayIntervalMs > 0) {
    ctx.effect(() => {
      const timer = setInterval(() => {
        void runShortTermDecay(store)
          .then((summary) => {
            const total = summary.daily.archived.length + summary.work.archived.length
            if (total > 0) {
              ctx.logger.info(`memory: decay archived ${total} short-term item(s) (daily ${summary.daily.archived.length}, work ${summary.work.archived.length})`)
            }
          })
          .catch((error: unknown) => {
            ctx.logger.warn(`memory: decay failed: ${String(error)}`)
          })
      }, decayIntervalMs)
      return () => clearInterval(timer)
    }, 'memory.decayTimer')
  }

  // Periodic reflection loop (pull → distill → store): pull recent public
  // memories / error fingerprints / proposals / unresolved items, distill
  // deterministic patterns, and append one periodic reflection per day. The
  // model deepens the analysis on demand via the brain_memory_reflect tool. Timer is
  // disposed with the plugin; runs are idempotent within a calendar day.
  const reflectionIntervalMs = resolved.reflectionIntervalHours * 3_600_000
  if (reflectionIntervalMs > 0) {
    ctx.effect(() => {
      const timer = setInterval(() => {
        void runPeriodicReflection(store)
          .then((result) => {
            if (!result.skipped && result.record) {
              ctx.logger.info(`memory: periodic reflection stored ${result.record.id}`)
            }
          })
          .catch((error: unknown) => {
            ctx.logger.warn(`memory: periodic reflection failed: ${String(error)}`)
          })
      }, reflectionIntervalMs)
      return () => clearInterval(timer)
    }, 'memory.reflectionTimer')
  }

  // Auto-record every user exchange into short-term + long-term + the
  // session's portable doc. Short-term is the session's working memory, the
  // long-term copy is deduped and searchable across sessions, and the portable
  // doc keeps its original role (session goal / solved / unresolved).
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    if (text.trim() === '') return
    void autoRecordExchange(store, agent.session.id, text, {
      ...resolved.autoRecord,
      // Best-effort: index newly created long-term memories into the vector store.
      ...(semantic !== undefined
        ? { onLongRecord: (entry) => { void semantic?.indexOne(entry).catch(() => {}) } }
        : {}),
    }).catch((error: unknown) => {
      ctx.logger.warn(`memory: auto-record exchange failed: ${String(error)}`)
    })
  })

  if (resolved.injectContext) {
    registerMemoryContext(ctx, store, { resumeHint: resolved.resumeHint })
  }
}
