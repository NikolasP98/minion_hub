import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { env } from '$env/dynamic/private';
import { recordAiUsage, type ProviderUsage } from '$server/ai-usage';
import { assertAiCallAllowed, isEnforced } from '$server/services/entitlements.service';
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
    // Spec 043 backstop: refuse before the provider is called (no-op unless enforced).
    if (isEnforced()) await assertAiCallAllowed('llm');
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
    if (isEnforced()) await assertAiCallAllowed('llm');
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
        recordAiUsage({
          model: model.modelId,
          usage,
          durationMs: Date.now() - startedAt,
          ok: true,
        });
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
export function getOpenRouterModel(
  modelId: string,
  bounded?: { mode: 'pulse-digest-v1'; fetch: typeof fetch },
) {
  if (bounded) {
    if (!env.OPENROUTER_API_KEY) throw new Error('digest_transport_unconfigured');
    // The digest owns one bounded terminal-envelope transport; metering stays shared.
    const digestProvider = createOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      fetch: bounded.fetch,
    });
    return wrapLanguageModel({ model: digestProvider.chat(modelId), middleware: usageMiddleware });
  }
  return wrapLanguageModel({ model: openrouter()(modelId), middleware: usageMiddleware });
}

/** Parse an already received terminal envelope with the installed adapter. This
 * closed transport cannot make a network request or create another inference bill. */
export async function validateOpenRouterDigestReceipt(
  modelId: string,
  rawResponse: string,
  status: number,
): Promise<void> {
  if (status !== 200 || Buffer.byteLength(rawResponse) > 65536)
    throw new Error('digest_sdk_receipt');
  const local = createOpenAI({
    apiKey: 'local-receipt-validation',
    baseURL: 'https://receipt.invalid',
    fetch: async () =>
      new Response(rawResponse, { status, headers: { 'content-type': 'application/json' } }),
  });
  await local.chat(modelId).doGenerate({
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Validate the retained envelope locally.' }],
      },
    ],
    maxOutputTokens: 1024,
    abortSignal: AbortSignal.timeout(2000),
  });
}

/** Prove this installed adapter/model can serialize the approved wire cap before
 * reserving an attempt. The module-private transport returns only local bytes. */
export async function assertOpenRouterDigestWireSupport(
  modelId: string,
  prompt: string,
): Promise<void> {
  let observed = false;
  const local = createOpenAI({
    apiKey: 'local-wire-validation',
    baseURL: 'https://receipt.invalid',
    fetch: async (input, init) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      const value = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      if (
        !String(input).endsWith('/chat/completions') ||
        value.model !== modelId ||
        value.max_tokens !== 1024 ||
        value.max_completion_tokens !== undefined ||
        value.tools !== undefined ||
        value.models !== undefined ||
        value.stream === true ||
        Buffer.byteLength(String(init?.body)) > 65536
      )
        throw new Error('digest_unsupported_wire');
      observed = true;
      return new Response(
        JSON.stringify({
          id: 'local-wire',
          model: modelId,
          choices: [
            { index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });
  await local.chat(modelId).doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxOutputTokens: 1024,
    abortSignal: AbortSignal.timeout(2000),
  });
  if (!observed) throw new Error('digest_unsupported_wire');
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
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  return estimateCostUsd(model, promptTokens, completionTokens);
}
