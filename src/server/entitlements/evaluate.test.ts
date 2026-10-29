import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURES, PLAN_DEFAULTS, has, kind, all, type FeatureDef } from './catalog';
import { evaluateAll, expandFeatures, isEntitled, normalizePlan } from './evaluate';

const base = { plan: 'base', kind: 'business' } as const;
const premium = { plan: 'premium', kind: 'business' } as const;

afterEach(() => {
  vi.restoreAllMocks();
  (FEATURES as FeatureDef[]).splice(4);
  PLAN_DEFAULTS.base = [];
  PLAN_DEFAULTS.premium = ['ai', 'marketplace'];
});

describe('entitlement evaluator', () => {
  it('Base grants nothing', () => {
    expect(expandFeatures(base)).toEqual([]);
    expect(isEntitled(base, 'ai')).toEqual({ allowed: false, reason: 'not_in_plan' });
  });

  it('Premium expands to the full catalog', () => {
    expect(expandFeatures(premium)).toEqual(['ai', 'ai.chat', 'ai.proactive', 'marketplace']);
  });

  it('a child listed without its parent grants nothing', () => {
    PLAN_DEFAULTS.base = ['ai.chat'];
    expect(isEntitled(base, 'ai.chat').allowed).toBe(false);
    expect(expandFeatures(base)).toEqual([]);
  });

  it('applies a rule on org kind', () => {
    (FEATURES as FeatureDef[]).push({
      key: 'ruled',
      label: 'r',
      description: 'r',
      rule: kind('personal'),
    });
    PLAN_DEFAULTS.premium = ['ai', 'marketplace', 'ruled'];
    expect(isEntitled(premium, 'ruled')).toEqual({ allowed: false, reason: 'rule_false' });
    expect(isEntitled({ plan: 'premium', kind: 'personal' }, 'ruled').allowed).toBe(true);
  });

  it('has() reads earlier keys only', () => {
    (FEATURES as FeatureDef[]).push(
      { key: 'early', label: 'e', description: 'e', rule: has('late') },
      { key: 'late', label: 'l', description: 'l' },
      { key: 'after', label: 'a', description: 'a', rule: all(has('ai')) },
    );
    PLAN_DEFAULTS.premium = ['ai', 'early', 'late', 'after'];
    const r = evaluateAll(premium);
    expect(r.get('early')).toEqual({ allowed: false, reason: 'rule_false' });
    expect(r.get('late')?.allowed).toBe(true);
    expect(r.get('after')?.allowed).toBe(true);
  });

  it('an unknown feature key is denied with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isEntitled(premium, 'nope')).toEqual({ allowed: false, reason: 'not_in_plan' });
    expect(warn).toHaveBeenCalled();
  });

  it('an unknown plan key resolves as Base', () => {
    expect(normalizePlan('gold')).toBe('base');
    expect(normalizePlan(null)).toBe('base');
    expect(normalizePlan('premium')).toBe('premium');
    expect(normalizePlan('constructor')).toBe('base');
    expect(normalizePlan('__proto__')).toBe('base');
  });
});
