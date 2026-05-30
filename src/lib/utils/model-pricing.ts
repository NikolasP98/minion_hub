/**
 * Per-model pricing — mirrors the gateway's `src/providers/pricing.ts` so the
 * Hub can compute LLM token costs (tokens × price per model/provider) entirely
 * client-side from the `agent.llm.usage` events it already receives. Keeping the
 * table here (rather than shipping cost over the wire) means cost analytics work
 * without a gateway redeploy, and the pricing stays auditable in one obvious place.
 *
 * Prices are USD per 1M tokens. Sources: official pricing pages (Mar 2026) +
 * ClawRouter v0.10.0 audit. Treat as ESTIMATES — verify against provider invoices
 * for billing-grade accuracy.
 */

export type ModelPricing = {
	/** USD per 1M input tokens. */
	inputPerMillion: number;
	/** USD per 1M output tokens. */
	outputPerMillion: number;
};

/** Key format: lowercase bare model id (no provider prefix). Local models = no entry (cost 0). */
export const MODEL_PRICING: Record<string, ModelPricing> = {
	// Anthropic
	'claude-opus-4': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
	'claude-sonnet-4': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
	'claude-haiku-4': { inputPerMillion: 1.0, outputPerMillion: 5.0 },
	'claude-haiku-3.5': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
	'claude-3.5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
	'claude-3-opus': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
	'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },

	// OpenAI
	'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
	'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
	'gpt-4-turbo': { inputPerMillion: 10.0, outputPerMillion: 30.0 },
	'gpt-4': { inputPerMillion: 30.0, outputPerMillion: 60.0 },
	'gpt-5.2': { inputPerMillion: 10.0, outputPerMillion: 30.0 },
	o1: { inputPerMillion: 15.0, outputPerMillion: 60.0 },
	'o1-mini': { inputPerMillion: 3.0, outputPerMillion: 12.0 },
	o3: { inputPerMillion: 10.0, outputPerMillion: 40.0 },
	'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
	'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },

	// Google
	'gemini-3.1-pro': { inputPerMillion: 2.5, outputPerMillion: 15.0 },
	'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
	'gemini-2.5-flash-lite': { inputPerMillion: 0.05, outputPerMillion: 0.2 },
	'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
	'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
	'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
	'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },

	// Groq / Mistral / DeepSeek / xAI
	'mixtral-8x7b': { inputPerMillion: 0.24, outputPerMillion: 0.24 },
	'mistral-large': { inputPerMillion: 2.0, outputPerMillion: 6.0 },
	codestral: { inputPerMillion: 0.3, outputPerMillion: 0.9 },
	'pixtral-large': { inputPerMillion: 2.0, outputPerMillion: 6.0 },
	'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
	'deepseek-coder': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
	'deepseek-r1': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
	'grok-2': { inputPerMillion: 2.0, outputPerMillion: 10.0 },
	'grok-3': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
};

/** Cache-read tokens bill at a fraction of base input (~0.1× for Anthropic prompt caching). */
const CACHE_READ_DISCOUNT = 0.1;

/**
 * Look up pricing for a model id. Strips any `provider/` prefix, then tries an
 * exact match followed by a longest-prefix match (so `claude-opus-4-8` →
 * `claude-opus-4`). Returns undefined for unknown/local models (cost = 0).
 */
export function getModelPricing(modelId: string): ModelPricing | undefined {
	if (!modelId) return undefined;
	let lower = modelId.toLowerCase();
	// Drop provider prefix (e.g. "anthropic/claude-sonnet-4" → "claude-sonnet-4").
	const slash = lower.lastIndexOf('/');
	if (slash >= 0) lower = lower.slice(slash + 1);

	const exact = MODEL_PRICING[lower];
	if (exact) return exact;

	// Longest-prefix match — pick the most specific key that prefixes the id.
	let best: ModelPricing | undefined;
	let bestLen = 0;
	for (const [key, value] of Object.entries(MODEL_PRICING)) {
		if (lower.startsWith(key) && key.length > bestLen) {
			best = value;
			bestLen = key.length;
		}
	}
	return best;
}

/** True when we have a price for this model (vs. an unpriced/local model). */
export function isModelPriced(modelId: string): boolean {
	return getModelPricing(modelId) !== undefined;
}

/**
 * Estimate cost in USD for one LLM call's token usage. Output tokens are billed
 * at the (higher) output rate; cache-read tokens at a discounted input rate.
 * Returns 0 for unknown/local models.
 */
export function estimateCostUsd(
	modelId: string,
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens = 0,
): number {
	const pricing = getModelPricing(modelId);
	if (!pricing) return 0;
	return (
		(inputTokens / 1_000_000) * pricing.inputPerMillion +
		(outputTokens / 1_000_000) * pricing.outputPerMillion +
		(cacheReadTokens / 1_000_000) * pricing.inputPerMillion * CACHE_READ_DISCOUNT
	);
}

/** Format a USD cost for compact dashboard display ($1.2k / $3.40 / 12.3¢ / <0.1¢). */
export function formatUsd(usd: number): string {
	if (usd <= 0) return '$0';
	if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
	if (usd >= 1) return `$${usd.toFixed(2)}`;
	const cents = usd * 100;
	if (cents >= 0.1) return `${cents.toFixed(1)}¢`;
	return '<0.1¢';
}

/**
 * A single currency unit for a whole chart axis, so ticks never mix `$` and `¢`.
 * Picks dollars when the largest value is ≥ $1, otherwise cents.
 */
export type MoneyUnit = 'usd' | 'cents';

export function pickMoneyUnit(maxUsd: number): MoneyUnit {
	return maxUsd >= 1 ? 'usd' : 'cents';
}

/** Format a USD value in a FIXED unit (no auto-switching) — for axis ticks/labels. */
export function formatMoney(usd: number, unit: MoneyUnit): string {
	if (unit === 'usd') {
		if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
		return `$${usd.toFixed(2)}`;
	}
	const cents = usd * 100;
	if (cents > 0 && cents < 0.1) return '<0.1¢';
	return `${cents.toFixed(1)}¢`;
}

/** Human label for the chosen unit, e.g. for an axis title. */
export function moneyUnitLabel(unit: MoneyUnit): string {
	return unit === 'usd' ? 'USD ($)' : 'cents (¢)';
}
