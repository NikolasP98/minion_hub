import { env } from '$env/dynamic/private';

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

/** Embed a single string. Throws if no embedding provider is configured. */
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

/** Embed a batch. Returns vectors in input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const provider = resolveEmbedProvider();
  if (!provider) {
    throw new Error('No embeddings provider configured (set OPENROUTER_API_KEY or OPENAI_API_KEY)');
  }

  for (let attempt = 1; attempt <= EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          input: texts.map((t) => t.slice(0, 8000)),
        }),
        signal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      if (attempt >= EMBEDDING_MAX_ATTEMPTS) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      continue;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const failure = new Error(`Embeddings failed (${res.status}): ${detail.slice(0, 200)}`);
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt >= EMBEDDING_MAX_ATTEMPTS) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      continue;
    }

    try {
      const json = (await res.json()) as { data?: unknown };
      if (!Array.isArray(json.data) || json.data.length !== texts.length) {
        throw new Error(
          `Embeddings returned ${Array.isArray(json.data) ? json.data.length : 0} vectors for ${texts.length} inputs`,
        );
      }
      const ordered = new Array<number[] | undefined>(texts.length);
      for (const candidate of json.data as EmbeddingResponseItem[]) {
        if (
          !candidate ||
          !Number.isInteger(candidate.index) ||
          candidate.index < 0 ||
          candidate.index >= texts.length ||
          ordered[candidate.index]
        ) {
          throw new Error('Embeddings returned invalid or duplicate vector indices');
        }
        if (
          !Array.isArray(candidate.embedding) ||
          candidate.embedding.length !== EMBEDDING_DIMENSIONS ||
          !candidate.embedding.every(Number.isFinite)
        ) {
          throw new Error(
            `Embeddings returned an invalid ${EMBEDDING_DIMENSIONS}-dimension vector`,
          );
        }
        ordered[candidate.index] = candidate.embedding;
      }
      if (ordered.some((embedding) => !embedding)) {
        throw new Error('Embeddings response omitted one or more vector indices');
      }
      return ordered as number[][];
    } catch (cause) {
      if (attempt >= EMBEDDING_MAX_ATTEMPTS) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error('Embeddings failed after retries');
}

/** Serialize a vector to the pgvector text literal form: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
