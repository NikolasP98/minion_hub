import { env } from '$env/dynamic/private';

/**
 * OpenAI text embeddings for the agent-memory corpus. Uses the REST API
 * directly (no SDK dependency). Dimension MUST match the `agent_memories.embedding`
 * pgvector column (1536 = text-embedding-3-small).
 */
const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

export function embeddingsEnabled(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/** Embed a single string. Throws if OPENAI_API_KEY is unset. */
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

/** Embed a batch. Returns vectors in input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for embeddings');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts.map((t) => t.slice(0, 8000)),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  // Order by `index` defensively — OpenAI returns in order but don't rely on it.
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Serialize a vector to the pgvector text literal form: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
