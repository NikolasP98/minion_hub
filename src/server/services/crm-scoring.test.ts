import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleStage,
  effectiveStage,
  compileTagRule,
  tryCompileTagRule,
  TagRuleError,
  type ContactStats,
} from './crm-scoring';

const NOW = new Date('2026-06-13T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function stats(p: Partial<ContactStats>): ContactStats {
  return {
    messageCount: 0,
    inboundCount: 0,
    firstContactAt: null,
    lastContactAt: null,
    ...p,
  };
}

describe('deriveLifecycleStage', () => {
  it('Churned when silent > 90d', () => {
    expect(deriveLifecycleStage(stats({ lastContactAt: daysAgo(120), messageCount: 50 }), NOW)).toBe(
      'Churned',
    );
  });

  it('Dormant between 30 and 90 days', () => {
    expect(deriveLifecycleStage(stats({ lastContactAt: daysAgo(45), messageCount: 20 }), NOW)).toBe(
      'Dormant',
    );
  });

  it('Active when recent and high volume', () => {
    expect(
      deriveLifecycleStage(
        stats({ lastContactAt: daysAgo(5), messageCount: 15, inboundCount: 8 }),
        NOW,
      ),
    ).toBe('Active');
  });

  it('Engaged when recent two-way but low volume', () => {
    expect(
      deriveLifecycleStage(
        stats({ lastContactAt: daysAgo(3), messageCount: 4, inboundCount: 2 }),
        NOW,
      ),
    ).toBe('Engaged');
  });

  it('New when just appeared with few messages', () => {
    expect(
      deriveLifecycleStage(
        stats({ firstContactAt: daysAgo(2), lastContactAt: daysAgo(2), messageCount: 1, inboundCount: 1 }),
        NOW,
      ),
    ).toBe('New');
  });

  it('zero tracked messages → New (imported/manual contact, not Churned)', () => {
    expect(deriveLifecycleStage(stats({}), NOW)).toBe('New');
  });

  it('previously-engaged then silent (has messages) → Churned', () => {
    expect(
      deriveLifecycleStage(stats({ lastContactAt: daysAgo(200), messageCount: 5 }), NOW),
    ).toBe('Churned');
  });
});

describe('effectiveStage', () => {
  it('override wins over derived', () => {
    expect(effectiveStage('VIP', stats({ lastContactAt: daysAgo(200) }), NOW)).toBe('VIP');
  });
  it('falls back to derived when override empty/null', () => {
    const churned = stats({ lastContactAt: daysAgo(200), messageCount: 5, inboundCount: 3 });
    expect(effectiveStage(null, churned, NOW)).toBe('Churned');
    expect(effectiveStage('', churned, NOW)).toBe('Churned');
  });
});

describe('compileTagRule', () => {
  it('compiles a numeric leaf', () => {
    expect(compileTagRule({ field: 'score', op: '>=', value: 80 })).toBe('(score >= 80)');
  });

  it('compiles a string leaf with quoting', () => {
    expect(compileTagRule({ field: 'stage', op: '=', value: 'Churned' })).toBe("(stage = 'Churned')");
  });

  it('compiles all / any groups', () => {
    expect(
      compileTagRule({
        all: [
          { field: 'score', op: '>=', value: 70 },
          { field: 'reciprocity', op: '>=', value: 0.4 },
        ],
      }),
    ).toBe('((score >= 70) and (reciprocity >= 0.4))');
    expect(
      compileTagRule({
        any: [
          { field: 'stage', op: '=', value: 'Dormant' },
          { field: 'last_days', op: '>', value: 30 },
        ],
      }),
    ).toBe("((stage = 'Dormant') or (last_days > 30))");
  });

  // ── Security: injection resistance ──
  it('rejects an unknown (non-whitelisted) field — no column injection', () => {
    expect(() =>
      compileTagRule({ field: 'id; drop table crm_contacts; --' as never, op: '=', value: 1 }),
    ).toThrow(TagRuleError);
  });

  it('escapes single quotes in string values', () => {
    expect(compileTagRule({ field: 'stage', op: '=', value: "x'; drop table--" })).toBe(
      "(stage = 'x''; drop table--')",
    );
  });

  it('rejects a string operator on a numeric field misuse and vice-versa', () => {
    expect(() => compileTagRule({ field: 'score', op: 'like' as never, value: 1 })).toThrow(
      TagRuleError,
    );
    expect(() => compileTagRule({ field: 'stage', op: '>', value: 'x' })).toThrow(TagRuleError);
  });

  it('rejects a non-numeric value for a numeric field', () => {
    expect(() => compileTagRule({ field: 'score', op: '>=', value: 'lots' })).toThrow(TagRuleError);
  });

  it('rejects empty groups and over-deep nesting', () => {
    expect(() => compileTagRule({ all: [] })).toThrow(TagRuleError);
  });

  it('tryCompileTagRule returns null instead of throwing', () => {
    expect(tryCompileTagRule({ field: 'bogus', op: '=', value: 1 })).toBeNull();
    expect(tryCompileTagRule({ field: 'score', op: '>=', value: 80 })).toBe('(score >= 80)');
  });
});
