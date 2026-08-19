import { AsyncLocalStorage } from 'node:async_hooks';
import { getCoreDb } from '$server/db/pg-client';
import { aiUsage } from '$server/db/pg-schema/ai-usage';
import { estimateCostUsd } from '$lib/utils/model-pricing';

/**
 * Request-scoped attribution for LLM usage.
 *
 * The usage middleware in `$server/llm` sees the model and the token counts but
 * not *who* the call was for. Threading an org id through 20 call sites (and
 * every service between them) would be a large diff for a telemetry concern, so
 * the org rides an AsyncLocalStorage scope instead — the same pattern already
 * used by `$server/db/pg-client` and `$server/gateway-channel`.
 *
 * The store is a MUTABLE object opened by `hooks.server.ts` at the top of the
 * request and filled in later by `getTenantCtx` once the tenant actually
 * resolves. That ordering is why this is not a plain immutable ALS value:
 * `handle` runs before authentication, so the org id is not known yet when the
 * scope is created. Deliberately NOT `enterWith()`, which can leak a store into
 * a sibling async context.
 */
export interface AiUsageScope {
  orgId: string | null;
  route: string | null;
  feature: string | null;
}

const scopeContext = new AsyncLocalStorage<AiUsageScope>();

/** Open a usage scope for one request. Called from `hooks.server.ts`. */
export function runWithAiUsageScope<T>(scope: AiUsageScope, fn: () => T): T {
  return scopeContext.run(scope, fn);
}

/** Fill in the tenant once it resolves. No-op outside a scope (scripts, tests). */
export function setAiUsageOrg(orgId: string): void {
  const scope = scopeContext.getStore();
  if (scope && !scope.orgId) scope.orgId = orgId;
}

/**
 * Label a block of work with a logical feature name, so cost can be attributed
 * to a pipeline rather than only to the HTTP route that triggered it. The five
 * cron pipelines all run behind a couple of generic tick endpoints, so route
 * alone cannot separate them.
 */
export function withAiUsageFeature<T>(feature: string, fn: () => T): T {
  const parent = scopeContext.getStore();
  return scopeContext.run(
    { orgId: parent?.orgId ?? null, route: parent?.route ?? null, feature },
    fn,
  );
}

/**
 * Run a block attributed to a specific org — for cron work that fans out across
 * tenants inside a single request, where the request-scope org is null or wrong.
 */
export function withAiUsageOrg<T>(orgId: string | null, feature: string | null, fn: () => T): T {
  const parent = scopeContext.getStore();
  return scopeContext.run({ route: parent?.route ?? null, feature, orgId }, fn);
}

export function currentAiUsageScope(): AiUsageScope | undefined {
  return scopeContext.getStore();
}

/**
 * The provider-level (V4) usage shape the middleware receives. Note this is the
 * NESTED provider shape, not the flat `LanguageModelUsage` that `generateText`
 * hands back to application code — middleware sits below that translation.
 */
export interface ProviderUsage {
  inputTokens?: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: { total?: number; text?: number; reasoning?: number };
  raw?: unknown;
}

/**
 * OpenRouter reports the real charge for a call in its `usage` payload. Pull it
 * out of the provider's raw usage rather than trusting our local price table,
 * which has already gone stale once (models with no entry silently cost 0).
 *
 * Shape varies by provider, so this reads defensively and returns null when the
 * provider says nothing — never a fabricated number.
 */
export function extractProviderCost(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const direct = record.cost;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  // OpenRouter nests the upstream charge under cost_details on some routes.
  const details = record.cost_details;
  if (details && typeof details === 'object') {
    const upstream = (details as Record<string, unknown>).upstream_inference_cost;
    if (typeof upstream === 'number' && Number.isFinite(upstream)) return upstream;
  }
  return null;
}

/** Flatten the provider's nested usage into the flat columns the ledger stores. */
export function flattenUsage(usage: ProviderUsage | undefined) {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  const cacheRead = input?.cacheRead ?? 0;
  const cacheWrite = input?.cacheWrite ?? 0;
  // `noCache` is the honest "billed at full input rate" figure. When a provider
  // omits it, fall back to total-minus-cached rather than to total — charging
  // cache reads at the full input rate would overstate the cost severalfold.
  const noCache = input?.noCache ?? Math.max(0, (input?.total ?? 0) - cacheRead - cacheWrite);
  const totalOutput = output?.total ?? 0;
  const reasoning = output?.reasoning ?? 0;
  return {
    inputTokens: noCache,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: totalOutput,
    reasoningTokens: reasoning,
  };
}

export interface RecordedUsage {
  model: string;
  usage?: ProviderUsage;
  durationMs?: number;
  ok?: boolean;
}

/** Build the ledger row without writing it — the unit-testable half of recording. */
export function buildUsageRow(entry: RecordedUsage, scope?: AiUsageScope) {
  const tokens = flattenUsage(entry.usage);
  return {
    orgId: scope?.orgId ?? null,
    route: scope?.route ?? null,
    feature: scope?.feature ?? null,
    model: entry.model,
    ...tokens,
    // Reasoning tokens are already counted inside `outputTokens.total`, so they
    // are NOT added again here — doing so would double-bill every reasoning model.
    costUsd: estimateCostUsd(
      entry.model,
      tokens.inputTokens,
      tokens.outputTokens,
      tokens.cacheReadTokens,
    ),
    providerCostUsd: extractProviderCost(entry.usage?.raw),
    durationMs: entry.durationMs ?? null,
    ok: entry.ok ?? true,
  };
}

/**
 * Write one usage row. Fire-and-forget: metering must never fail a user's
 * request or add latency to it, and a lost row costs us an estimate, not money
 * (the provider invoice remains the backstop).
 *
 * ponytail: one INSERT per LLM call. At current volumes that is nothing. If a
 * bulk pipeline ever makes this the hot path, buffer per-scope and flush once —
 * but do that when the writes show up in the slow-query log, not before.
 */
export function recordAiUsage(entry: RecordedUsage): void {
  // Wrapped, not just `.catch()`-ed: `getCoreDb()` throws SYNCHRONOUSLY when the
  // DB is unconfigured, so a promise-only guard would still let a metering
  // failure escape into the caller's request path. Nothing about recording usage
  // is worth failing a user's LLM call over.
  try {
    const row = buildUsageRow(entry, scopeContext.getStore());
    void getCoreDb()
      .insert(aiUsage)
      .values(row)
      .catch((error: unknown) => {
        console.warn('[ai-usage] failed to record usage', error);
      });
  } catch (error) {
    console.warn('[ai-usage] failed to record usage', error);
  }
}
