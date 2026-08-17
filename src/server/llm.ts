import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { env } from '$env/dynamic/private';
import { recordAiUsage, type ProviderUsage } from '$server/ai-usage';
import { estimateCostUsd } from '$lib/utils/model-pricing';

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
 * Cost estimate for the builder AI endpoints.
 *
 * This used to carry its OWN price table, which is how it ended up with exactly
 * four entries — none of them a model the hub still calls. A second price table
 * has no reason to be kept current, so it silently went stale and every estimate
 * it produced was zero. It now delegates to `$lib/utils/model-pricing`, the one
 * table, which also gets `:batch` and cache-read handling for free.
 */
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  return estimateCostUsd(model, promptTokens, completionTokens);
}
