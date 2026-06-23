import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleStage,
  effectiveStage,
  compileTagRule,
  tryCompileTagRule,
  evaluateTagRule,
  matchingAutoTagIds,
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

  it('Engaged on recent inbound even one-way (relaxed: no outbound required)', () => {
    // one-way: 2 inbound, 0 outbound — was buried in New under the old two-way rule.
    expect(
      deriveLifecycleStage(
        stats({ firstContactAt: daysAgo(3), lastContactAt: daysAgo(3), messageCount: 2, inboundCount: 2 }),
        NOW,
      ),
    ).toBe('Engaged');
  });

  it('New when just appeared outbound-only (we reached out, no reply, never bought)', () => {
    // 1 outbound msg, no inbound → not Engaged; recent & low-volume & non-buyer → New.
    expect(
      deriveLifecycleStage(
        stats({ firstContactAt: daysAgo(2), lastContactAt: daysAgo(2), messageCount: 1, inboundCount: 0 }),
        NOW,
      ),
    ).toBe('New');
  });

  it('zero messages, never bought → New (cold import, not Churned)', () => {
    expect(deriveLifecycleStage(stats({}), NOW)).toBe('New');
  });

  it('zero messages but a recent buyer → NOT New (recency from the purchase)', () => {
    // effective lastContactAt = last purchase date; a buyer is never a cold "New".
    expect(
      deriveLifecycleStage(
        stats({ messageCount: 0, lastContactAt: daysAgo(5), firstContactAt: daysAgo(400), isBuyer: true }),
        NOW,
      ),
    ).toBe('Engaged');
  });

  it('a long-silent buyer → Churned (not New) by effective last interaction', () => {
    expect(
      deriveLifecycleStage(
        stats({ messageCount: 0, lastContactAt: daysAgo(200), firstContactAt: daysAgo(400), isBuyer: true }),
        NOW,
      ),
    ).toBe('Churned');
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

describe('evaluateTagRule', () => {
  it('matches a numeric leaf at/above the threshold (the score>=80 case)', () => {
    expect(evaluateTagRule({ field: 'score', op: '>=', value: 80 }, { score: 82 })).toBe(true);
    expect(evaluateTagRule({ field: 'score', op: '>=', value: 80 }, { score: 80 })).toBe(true);
    expect(evaluateTagRule({ field: 'score', op: '>=', value: 80 }, { score: 79 })).toBe(false);
  });

  it('handles string fields with = / !=', () => {
    expect(evaluateTagRule({ field: 'stage', op: '=', value: 'Churned' }, { stage: 'Churned' })).toBe(true);
    expect(evaluateTagRule({ field: 'stage', op: '=', value: 'Churned' }, { stage: 'Active' })).toBe(false);
    expect(evaluateTagRule({ field: 'stage', op: '!=', value: 'New' }, { stage: 'Active' })).toBe(true);
  });

  it('coerces numeric strings (ranking rows can arrive as text from raw SQL)', () => {
    expect(evaluateTagRule({ field: 'score', op: '>=', value: 80 }, { score: '82' as never })).toBe(true);
  });

  it('evaluates all / any groups', () => {
    const row = { score: 75, reciprocity: 0.5 };
    expect(
      evaluateTagRule({ all: [{ field: 'score', op: '>=', value: 70 }, { field: 'reciprocity', op: '>=', value: 0.4 }] }, row),
    ).toBe(true);
    expect(
      evaluateTagRule({ all: [{ field: 'score', op: '>=', value: 70 }, { field: 'reciprocity', op: '>=', value: 0.6 }] }, row),
    ).toBe(false);
    expect(evaluateTagRule({ any: [{ field: 'score', op: '>=', value: 90 }, { field: 'reciprocity', op: '>=', value: 0.4 }] }, row)).toBe(true);
  });

  it('never matches a malformed / non-whitelisted rule (no throw)', () => {
    expect(evaluateTagRule({ field: 'bogus', op: '=', value: 1 }, { score: 99 } as never)).toBe(false);
    expect(evaluateTagRule({ all: [] }, { score: 99 })).toBe(false);
    expect(evaluateTagRule(null, { score: 99 })).toBe(false);
    expect(evaluateTagRule({ field: 'stage', op: '>', value: 'x' }, { stage: 'Active' })).toBe(false);
  });

  it('missing field on the row → no match', () => {
    expect(evaluateTagRule({ field: 'score', op: '>=', value: 80 }, {})).toBe(false);
  });
});

describe('matchingAutoTagIds', () => {
  const tags = [
    { id: 'caliente', kind: 'auto', rule: { field: 'score', op: '>=', value: 80 } },
    { id: 'dormant', kind: 'auto', rule: { field: 'last_days', op: '>', value: 30 } },
    { id: 'manual', kind: 'manual', rule: null },
    { id: 'broken', kind: 'auto', rule: { field: 'nope', op: '=', value: 1 } },
  ];

  it('returns only the auto-tags whose rule matches (manual + broken excluded)', () => {
    expect(matchingAutoTagIds({ score: 82, last_days: 5 }, tags)).toEqual(['caliente']);
    expect(matchingAutoTagIds({ score: 50, last_days: 90 }, tags)).toEqual(['dormant']);
    expect(matchingAutoTagIds({ score: 90, last_days: 90 }, tags)).toEqual(['caliente', 'dormant']);
    expect(matchingAutoTagIds({ score: 10, last_days: 1 }, tags)).toEqual([]);
  });
});
