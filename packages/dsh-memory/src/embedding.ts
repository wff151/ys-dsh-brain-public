/**
 * Minimal OpenAI-compatible embedding client (LM Studio / llama.cpp
 * `--embedding` / OpenAI / any `/v1/embeddings` endpoint).
 *
 * The client is deliberately transport-only: it performs no caching, retry
 * storms or process-global state. Callers (the semantic service) decide when
 * to probe, when to back off, and how to degrade when the endpoint is absent.
 * @module dsh-brain-memory/src/embedding
 */

import { createHash } from 'node:crypto'

/** Configuration for {@link createEmbeddingClient}. */
export interface EmbeddingClientConfig {
  /** API base including `/v1`, e.g. `http://127.0.0.1:1234/v1`. */
  baseURL: string
  /** Embedding model id the endpoint expects. */
  model: string
  /** Optional bearer token (local servers usually need none). */
  apiKey?: string
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number
}

/** Thin embedding transport. */
export interface EmbeddingClient {
  readonly model: string
  /** Embed one or more texts; resolves to one dense vector per input (aligned). */
  embed(texts: string[]): Promise<number[][]>
}

/** Build the embeddings endpoint URL from a `/v1`-style base. */
function endpointOf(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  return trimmed.endsWith('/embeddings') ? trimmed : `${trimmed}/embeddings`
}

/**
 * Create an OpenAI-compatible embedding client. No network call is made until
 * {@link EmbeddingClient.embed} runs, so construction never blocks startup.
 */
export function createEmbeddingClient(config: EmbeddingClientConfig): EmbeddingClient {
  const endpoint = endpointOf(config.baseURL)
  const timeoutMs = config.timeoutMs ?? 5000
  return {
    model: config.model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: config.model, input: texts }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`embedding endpoint ${res.status}: ${detail.slice(0, 200)}`)
        }
        const payload = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
        const rows = payload.data ?? []
        // OpenAI returns data aligned by `index`; sort defensively, fall back to order.
        const ordered = [...rows].sort((a, b) => {
          const ia = (a as { index?: number }).index ?? 0
          const ib = (b as { index?: number }).index ?? 0
          return ia - ib
        })
        const vectors = ordered.map((row) => {
          if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
            throw new Error('embedding endpoint returned an empty/invalid vector')
          }
          return row.embedding
        })
        if (vectors.length !== texts.length) {
          throw new Error(`embedding count mismatch: sent ${texts.length}, got ${vectors.length}`)
        }
        return vectors
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Cosine similarity in [-1, 1]; returns 0 for zero/unequal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (typeof x !== 'number' || typeof y !== 'number') return 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Stable short hash of the text a memory was embedded from. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}
