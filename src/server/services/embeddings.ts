import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { recordAiUsage } from '$server/ai-usage';

/**
 * Text embeddings for the agent-memory corpus. Uses the OpenAI-compatible REST
 * API directly (no SDK). Dimension MUST match the `agent_memories.embedding`
 * pgvector column (1536 = text-embedding-3-small).
 *
 * Provider resolution prefers OpenRouter — its `/embeddings` endpoint is an
 * OpenAI-compatible proxy for `openai/text-embedding-3-small` (same 1536-dim
 * vectors) and OPENROUTER_API_KEY is already configured across the stack
 * (gateway, hub, Vercel). Falls back to a direct OPENAI_API_KEY. Note: a
 * project-scoped OpenAI key lacking the embeddings permission 403s on
 * api.openai.com — routing through OpenRouter avoids that.
 */
export const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_MAX_ATTEMPTS = 3;
const EMBEDDING_REQUEST_TIMEOUT_MS = Math.min(
  120_000,
  Math.max(5_000, Number(process.env.BRAIN_EMBEDDING_REQUEST_TIMEOUT_MS) || 45_000),
);

type EmbedProvider = { url: string; key: string; model: string };
type EmbeddingResponseItem = { index: number; embedding: number[] };

function resolveEmbedProvider(): EmbedProvider | null {
  if (env.OPENROUTER_API_KEY) {
    return {
      url: 'https://openrouter.ai/api/v1/embeddings',
      key: env.OPENROUTER_API_KEY,
      model: 'openai/text-embedding-3-small',
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      url: 'https://api.openai.com/v1/embeddings',
      key: env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
    };
  }
  return null;
}

export function embeddingsEnabled(): boolean {
  return resolveEmbedProvider() !== null;
}

export type EmbeddingOptions = { signal?: AbortSignal; attemptPolicy?: 'single' | 'retry' };
export type EmbeddingDescriptor = Readonly<{
  payloadHash: string;
  endpoint: string;
  model: string;
  normalization: string;
  count: number;
  dimensions: number;
}>;
export type PreparedEmbeddingRequest = Readonly<{ descriptor: EmbeddingDescriptor }>;
const prepared = new WeakMap<PreparedEmbeddingRequest, { provider: EmbedProvider; body: string }>();

/** Pin the actual request without exposing provider credentials or mutable text. */
export function prepareEmbeddingRequest(texts: string[]): PreparedEmbeddingRequest {
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    Array.from(texts).some((text) => typeof text !== 'string')
  )
    throw new Error('Embedding inputs must be non-empty strings array');
  const provider = resolveEmbedProvider();
  if (!provider)
    throw new Error('No embeddings provider configured (set OPENROUTER_API_KEY or OPENAI_API_KEY)');
  const body = JSON.stringify({
    model: provider.model,
    input: texts.map((text) => text.slice(0, 8000)),
  });
  const request = Object.freeze({
    descriptor: Object.freeze({
      payloadHash: createHash('sha256').update(body).digest('hex'),
      endpoint: provider.url,
      model: provider.model,
      normalization: 'embedding-text-v1',
      count: texts.length,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  prepared.set(request, { provider: { ...provider }, body });
  return request;
}

/** Bound caller waiting even if a transport ignores its signal. Late results are observed. */
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void;
  return new Promise<T>((resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(resolve, reject);
  }).finally(() => signal.removeEventListener('abort', abort));
}

async function retryWait(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(resolve, milliseconds);
      if (signal) {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
  } finally {
    clearTimeout(timer);
    if (signal && abort) signal.removeEventListener('abort', abort);
  }
}

class EmbeddingHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Existing callers retain bounded retries; durable job admissions explicitly select single. */
export async function embedTexts(
  texts: string[],
  options: EmbeddingOptions = {},
): Promise<number[][]> {
  options.signal?.throwIfAborted();
  if (texts.length === 0) return [];
  return executeEmbeddingRequest(prepareEmbeddingRequest(texts), options);
}

export async function embedText(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
  const [vector] = await embedTexts([text], options);
  return vector;
}

export async function executeEmbeddingRequest(
  request: PreparedEmbeddingRequest,
  options: EmbeddingOptions = {},
): Promise<number[][]> {
  const pinned = prepared.get(request);
  if (!pinned) throw new Error('Unknown prepared embedding request');
  if (options.attemptPolicy !== undefined && !['single', 'retry'].includes(options.attemptPolicy))
    throw new Error('Invalid embedding attempt policy');
  const attempts = options.attemptPolicy === 'single' ? 1 : EMBEDDING_MAX_ATTEMPTS;
  const { provider, body } = pinned;
  const count = request.descriptor.count;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException('Embedding request timed out', 'TimeoutError')),
      EMBEDDING_REQUEST_TIMEOUT_MS,
    );
    let failure: unknown;
    try {
      return await abortable(async () => {
        const res = await fetch(provider.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          controller.signal.throwIfAborted();
          throw new EmbeddingHttpError(
            `Embeddings failed (${res.status}): ${detail.slice(0, 200)}`,
            res.status === 429 || res.status >= 500,
          );
        }
        const json = (await res.json()) as { data?: unknown; usage?: { prompt_tokens?: number } };
        controller.signal.throwIfAborted();
        // Preserve raw-REST usage accounting; receipt identity is not a billing deduplication claim.
        recordAiUsage({
          model: provider.model,
          usage: {
            inputTokens: {
              total: json.usage?.prompt_tokens ?? 0,
              noCache: json.usage?.prompt_tokens ?? 0,
            },
          },
        });
        if (!Array.isArray(json.data) || json.data.length !== count)
          throw new Error(
            `Embeddings returned ${Array.isArray(json.data) ? json.data.length : 0} vectors for ${count} inputs`,
          );
        const ordered = new Array<number[] | undefined>(count);
        for (const candidate of json.data as EmbeddingResponseItem[]) {
          if (
            !candidate ||
            !Number.isInteger(candidate.index) ||
            candidate.index < 0 ||
            candidate.index >= count ||
            ordered[candidate.index]
          )
            throw new Error('Embeddings returned invalid or duplicate vector indices');
          if (
            !Array.isArray(candidate.embedding) ||
            candidate.embedding.length !== EMBEDDING_DIMENSIONS ||
            !candidate.embedding.every(Number.isFinite)
          )
            throw new Error(
              `Embeddings returned an invalid ${EMBEDDING_DIMENSIONS}-dimension vector`,
            );
          ordered[candidate.index] = candidate.embedding;
        }
        if (Array.from(ordered).some((vector) => !vector))
          throw new Error('Embeddings response omitted one or more vector indices');
        return ordered as number[][];
      }, controller.signal);
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
    options.signal?.throwIfAborted();
    if (attempt === attempts || (failure instanceof EmbeddingHttpError && !failure.retryable))
      throw failure;
    await retryWait(500 * 2 ** (attempt - 1), options.signal);
  }
  throw new Error('Embeddings failed after retries');
}

/** Serialize a vector to the pgvector text literal form: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
