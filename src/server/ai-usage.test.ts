import { describe, it, expect } from 'vitest';
import { buildUsageRow, extractProviderCost, flattenUsage, type ProviderUsage } from './ai-usage';

describe('flattenUsage', () => {
  it('keeps cached and uncached input tokens apart', () => {
    const usage: ProviderUsage = {
      inputTokens: { total: 1000, noCache: 200, cacheRead: 700, cacheWrite: 100 },
      outputTokens: { total: 50, text: 40, reasoning: 10 },
    };
    expect(flattenUsage(usage)).toEqual({
      inputTokens: 200,
      cacheReadTokens: 700,
      cacheWriteTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10,
    });
  });

  it('derives uncached input when the provider omits noCache', () => {
    // Falling back to `total` here would price 900 cached tokens at the full
    // input rate — a ~5x overstatement on a cache-heavy pipeline.
    const usage: ProviderUsage = {
      inputTokens: { total: 1000, cacheRead: 900 },
      outputTokens: { total: 10 },
    };
    expect(flattenUsage(usage).inputTokens).toBe(100);
  });

  it('reports zeros rather than throwing when usage is absent', () => {
    expect(flattenUsage(undefined).inputTokens).toBe(0);
  });
});

describe('extractProviderCost', () => {
  it('reads the provider-reported charge', () => {
    expect(extractProviderCost({ cost: 0.00123 })).toBe(0.00123);
  });

  it('falls back to the nested upstream cost', () => {
    expect(extractProviderCost({ cost_details: { upstream_inference_cost: 0.5 } })).toBe(0.5);
  });

  it('returns null rather than inventing a number when the provider is silent', () => {
    expect(extractProviderCost({ prompt_tokens: 10 })).toBeNull();
    expect(extractProviderCost(undefined)).toBeNull();
  });
});

describe('buildUsageRow', () => {
  const usage: ProviderUsage = {
    inputTokens: { total: 1_000_000, noCache: 1_000_000, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0 },
  };

  it('prices a model that was previously missing from the table', () => {
    // Regression guard: claude-opus-5 had no entry, so the lookup returned
    // undefined and the newest, most expensive model billed as FREE.
    const row = buildUsageRow({ model: 'anthropic/claude-opus-5', usage });
    expect(row.costUsd).toBeCloseTo(5.0, 6);
  });

  it('prices the default model at its real rate', () => {
    const row = buildUsageRow({
      model: 'google/gemini-2.5-flash',
      usage: { inputTokens: { noCache: 0 }, outputTokens: { total: 1_000_000 } },
    });
    // Was $0.60 in the stale table; the real output rate is $2.50.
    expect(row.costUsd).toBeCloseTo(2.5, 6);
  });

  it('halves the price for OpenRouter batch variants', () => {
    const row = buildUsageRow({ model: 'anthropic/claude-opus-5:batch', usage });
    expect(row.costUsd).toBeCloseTo(2.5, 6);
  });

  it('does not double-count reasoning tokens inside output', () => {
    const row = buildUsageRow({
      model: 'anthropic/claude-opus-5',
      usage: { inputTokens: { noCache: 0 }, outputTokens: { total: 1_000_000, reasoning: 400_000 } },
    });
    expect(row.costUsd).toBeCloseTo(25.0, 6);
  });

  it('prefers the provider cost over our estimate when both exist', () => {
    const row = buildUsageRow({
      model: 'anthropic/claude-opus-5',
      usage: { ...usage, raw: { cost: 0.042 } },
    });
    expect(row.providerCostUsd).toBe(0.042);
    expect(row.costUsd).toBeGreaterThan(0);
  });

  it('carries scope attribution onto the row', () => {
    const row = buildUsageRow(
      { model: 'google/gemini-2.5-flash', usage },
      { orgId: 'org-1', route: '/api/crm/tags/[id]/evaluate', feature: 'crm.tags' },
    );
    expect(row).toMatchObject({ orgId: 'org-1', feature: 'crm.tags' });
  });

  it('records a failed call with zeroed tokens rather than dropping it', () => {
    const row = buildUsageRow({ model: 'google/gemini-2.5-flash', ok: false });
    expect(row.ok).toBe(false);
    expect(row.costUsd).toBe(0);
  });
});
