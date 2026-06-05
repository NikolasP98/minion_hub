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

type EmbedProvider = { url: string; key: string; model: string };

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

  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      input: texts.map((t) => t.slice(0, 8000)),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Embeddings failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  // Order by `index` defensively — providers return in order but don't rely on it.
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Serialize a vector to the pgvector text literal form: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
