import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ponytail: module-level lazy singleton. Every caller already guards on
// env.OPENROUTER_API_KEY being truthy before it reaches here (each endpoint's
// existing `if (!apiKey) throw/return ...` check), so building the provider
// once on first use — rather than once per copy-pasted call site — is safe.
let provider: ReturnType<typeof createOpenAI> | undefined;

function openrouter() {
  if (!provider) {
    provider = createOpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: OPENROUTER_BASE_URL });
  }
  return provider;
}

/**
 * Shared OpenRouter-backed language model, replacing the `createOpenAI({...})`
 * block that used to be copy-pasted into ~12 files. Per-request extras that
 * varied by call site (HTTP-Referer/X-Title attribution headers) are NOT baked
 * in here — pass them via the `headers` option on generateText/generateObject/
 * streamObject, which the `ai` SDK merges into the request per-call.
 */
export function getOpenRouterModel(modelId: string) {
  return openrouter()(modelId);
}

/**
 * Per-1M-token pricing for the builder AI cost estimate. Was duplicated
 * identically in suggest-skill/+server.ts and suggest-chapter/+server.ts.
 */
export const MODEL_PRICE_TABLE: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'anthropic/claude-sonnet-4': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'anthropic/claude-haiku-3': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  'openai/gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const prices = MODEL_PRICE_TABLE[model];
  if (!prices) return 0;
  return (
    (promptTokens / 1_000_000) * prices.inputPerMillion +
    (completionTokens / 1_000_000) * prices.outputPerMillion
  );
}
