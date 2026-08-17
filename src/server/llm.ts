import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { env } from '$env/dynamic/private';
import { recordAiUsage, type ProviderUsage } from '$server/ai-usage';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ponytail: module-level lazy singleton. Every caller already guards on
// env.OPENROUTER_API_KEY being truthy before it reaches here (each endpoint's
// existing `if (!apiKey) throw/return ...` check), so building the provider
// once on first use — rather than once per copy-pasted call site — is safe.
let provider: ReturnType<typeof createOpenAI> | undefined;

/**
 * Asks OpenRouter to return what the call ACTUALLY cost.
 *
 * OpenRouter only includes the real charge in its `usage` payload when the
 * request body carries `usage: { include: true }`; without it you get token
 * counts and have to price them yourself. Pricing them ourselves is exactly the
 * thing that already broke (a model missing from the local table bills as zero),
 * so we ask the provider instead.
 *
 * It goes in a `fetch` shim because the OpenAI-compatible provider only forwards
 * body fields it knows about — there is no per-call option that survives to the
 * wire. Any failure to parse leaves the body untouched: worst case we lose the
 * provider cost and fall back to the estimate, never break the request.
 */
const withUsageAccounting: typeof fetch = (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      body.usage = { include: true };
      init = { ...init, body: JSON.stringify(body) };
    } catch {
      // Non-JSON body — leave it alone.
    }
  }
  return fetch(input, init);
};

function openrouter() {
  if (!provider) {
    provider = createOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      fetch: withUsageAccounting,
    });
  }
  return provider;
}

/**
 * Records token usage for every call that passes through this module.
 *
 * Sits as middleware rather than at the call sites because there are ~20 of the
 * latter and one of the former: a call site that forgets to meter is an invisible
 * hole in the cost data, and the only way to make that structurally impossible
 * is to make metering something you cannot opt out of. `getOpenRouterModel` is
 * the sole provider factory in `src/`, so wrapping it here is total coverage.
 *
 * Recording never throws and never blocks — a metering failure must not become
 * a user-visible LLM failure.
 */
const usageMiddleware: LanguageModelMiddleware = {
  async wrapGenerate({ doGenerate, model }) {
    const startedAt = Date.now();
    try {
      const result = await doGenerate();
      recordAiUsage({
        model: model.modelId,
        usage: result.usage as ProviderUsage | undefined,
        durationMs: Date.now() - startedAt,
        ok: true,
      });
      return result;
    } catch (error) {
      // A failed call still consumed input tokens upstream in most failure modes
      // (and always consumed wall-clock), so it belongs in the ledger. Token
      // counts are unknown here; the row records the attempt, not the amount.
      recordAiUsage({ model: model.modelId, durationMs: Date.now() - startedAt, ok: false });
      throw error;
    }
  },

  async wrapStream({ doStream, model }) {
    const startedAt = Date.now();
    const { stream, ...rest } = await doStream();
    let usage: ProviderUsage | undefined;

    // Usage only arrives on the terminal `finish` part, so the stream is tapped
    // rather than consumed — every chunk is forwarded untouched and the row is
    // written from `flush`, once the consumer has drained the stream.
    const meter = new TransformStream({
      transform(chunk, controller) {
        if (chunk?.type === 'finish' && chunk.usage) usage = chunk.usage as ProviderUsage;
        controller.enqueue(chunk);
      },
      flush() {
        recordAiUsage({ model: model.modelId, usage, durationMs: Date.now() - startedAt, ok: true });
      },
    });

    return { stream: stream.pipeThrough(meter), ...rest };
  },
};

/**
 * Shared OpenRouter-backed language model, replacing the `createOpenAI({...})`
 * block that used to be copy-pasted into ~12 files. Per-request extras that
 * varied by call site (HTTP-Referer/X-Title attribution headers) are NOT baked
 * in here — pass them via the `headers` option on generateText/generateObject/
 * streamObject, which the `ai` SDK merges into the request per-call.
 *
 * Every model returned is metered — see `usageMiddleware`.
 */
export function getOpenRouterModel(modelId: string) {
  return wrapLanguageModel({ model: openrouter()(modelId), middleware: usageMiddleware });
}

/**
 * Per-1M-token pricing for the builder AI cost estimate.
 *
 * @deprecated Use `estimateCostUsd` from `$lib/utils/model-pricing`, which is the
 * single price table. This copy exists only for the two builder endpoints that
 * still import `estimateCost`; it went stale (no Claude 5 / Gemini 2.5 entries)
 * precisely because a second table has no reason to be kept current. Delete once
 * those call sites move over.
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
