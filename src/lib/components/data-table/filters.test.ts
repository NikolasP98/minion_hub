import { describe, expect, it } from 'vitest';
import {
  emptyFilter,
  filterToParam,
  isFilterActive,
  matchesFilter,
  type FilterValue,
} from './filters';

describe('isFilterActive', () => {
  it('treats an empty selection, blank text and an unbounded range as inert', () => {
    expect(isFilterActive(null)).toBe(false);
    expect(isFilterActive({ kind: 'enum', values: [] })).toBe(false);
    expect(isFilterActive({ kind: 'text', text: '   ' })).toBe(false);
    expect(isFilterActive({ kind: 'number', min: null, max: null })).toBe(false);
    expect(isFilterActive({ kind: 'number', min: 0, max: null })).toBe(true);
    expect(isFilterActive({ kind: 'date', min: null, max: '2026-01-01' })).toBe(true);
  });

  it('emptyFilter round-trips to inert for every kind', () => {
    for (const kind of ['enum', 'text', 'number', 'date'] as const)
      expect(isFilterActive(emptyFilter(kind))).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('an inert filter matches everything', () => {
    expect(matchesFilter({ kind: 'text', text: '' }, 'anything')).toBe(true);
  });

  it('enum matches any of a row’s values', () => {
    const f: FilterValue = { kind: 'enum', values: ['a', 'b'] };
    expect(matchesFilter(f, 'a')).toBe(true);
    expect(matchesFilter(f, ['z', 'b'])).toBe(true);
    expect(matchesFilter(f, 'c')).toBe(false);
    expect(matchesFilter(f, null)).toBe(false);
  });

  it('text is a case-insensitive contains', () => {
    const f = { kind: 'text', text: ' LiP ' } as const;
    expect(matchesFilter(f, 'Relleno de labios / lip')).toBe(true);
    expect(matchesFilter(f, 'botox')).toBe(false);
  });

  it('number and date ranges include BOTH endpoints', () => {
    const n = { kind: 'number', min: 10, max: 20 } as const;
    expect([9, 10, 15, 20, 21].map((v) => matchesFilter(n, v))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    const d = { kind: 'date', min: '2026-06-01', max: '2026-06-30' } as const;
    expect(matchesFilter(d, '2026-06-01T09:00:00Z')).toBe(true);
    expect(matchesFilter(d, new Date('2026-06-30T23:59:00Z'))).toBe(true);
    expect(matchesFilter(d, '2026-07-01')).toBe(false);
  });

  it('a non-numeric value never satisfies a numeric range', () => {
    expect(matchesFilter({ kind: 'number', min: 1, max: null }, 'n/a')).toBe(false);
  });
});

describe('filterToParam', () => {
  it('keeps the historical comma-joined enum form and encodes a range as min~max', () => {
    expect(filterToParam({ kind: 'enum', values: ['a', 'b'] })).toBe('a,b');
    expect(filterToParam({ kind: 'text', text: ' hi ' })).toBe('hi');
    expect(filterToParam({ kind: 'number', min: 1, max: null })).toBe('1~');
    expect(filterToParam({ kind: 'date', min: null, max: '2026-01-31' })).toBe('~2026-01-31');
  });
});
