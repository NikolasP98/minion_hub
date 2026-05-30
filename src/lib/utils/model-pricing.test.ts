import { describe, it, expect } from 'vitest';
import { getModelPricing, isModelPriced, estimateCostUsd, formatUsd } from './model-pricing';

describe('getModelPricing', () => {
	it('matches a bare model id exactly', () => {
		expect(getModelPricing('claude-sonnet-4')).toEqual({ inputPerMillion: 3.0, outputPerMillion: 15.0 });
	});

	it('matches by longest prefix for versioned ids', () => {
		// claude-opus-4-8 should resolve to the claude-opus-4 entry.
		expect(getModelPricing('claude-opus-4-8')).toEqual({ inputPerMillion: 15.0, outputPerMillion: 75.0 });
	});

	it('strips a provider prefix before matching', () => {
		expect(getModelPricing('anthropic/claude-sonnet-4-6')).toEqual({
			inputPerMillion: 3.0,
			outputPerMillion: 15.0,
		});
	});

	it('is case-insensitive', () => {
		expect(getModelPricing('GPT-4O')).toEqual({ inputPerMillion: 2.5, outputPerMillion: 10.0 });
	});

	it('returns undefined for unknown/local models', () => {
		expect(getModelPricing('llama3-local')).toBeUndefined();
		expect(getModelPricing('')).toBeUndefined();
		expect(isModelPriced('ollama/qwen2')).toBe(false);
		expect(isModelPriced('claude-sonnet-4')).toBe(true);
	});
});

describe('estimateCostUsd', () => {
	it('computes input + output cost at per-million rates', () => {
		// 1M input @ $3 + 1M output @ $15 = $18
		expect(estimateCostUsd('claude-sonnet-4', 1_000_000, 1_000_000)).toBeCloseTo(18, 6);
	});

	it('adds discounted cache-read cost (~0.1x input)', () => {
		// + 1M cache-read @ $3 * 0.1 = $0.30
		expect(estimateCostUsd('claude-sonnet-4', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(18.3, 6);
	});

	it('returns 0 for unpriced models', () => {
		expect(estimateCostUsd('llama3-local', 1_000_000, 1_000_000)).toBe(0);
	});
});

describe('formatUsd', () => {
	it('formats across magnitudes', () => {
		expect(formatUsd(0)).toBe('$0');
		expect(formatUsd(1500)).toBe('$1.5k');
		expect(formatUsd(3.4)).toBe('$3.40');
		expect(formatUsd(0.05)).toBe('5.0¢');
		expect(formatUsd(0.0005)).toBe('<0.1¢');
	});
});
