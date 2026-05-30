import { describe, expect, it } from 'vitest';

import {
  cachedPct,
  orderBand,
  sortSections,
  type SectionEntry,
} from './types';

function s(partial: Partial<SectionEntry> & { id: string }): SectionEntry {
  return {
    layer: 'platform',
    label: partial.id,
    chars: 0,
    order: 0,
    ...partial,
  };
}

describe('cachedPct', () => {
  it('returns 0 for an empty list', () => {
    expect(cachedPct([])).toBe(0);
  });

  it('returns 0 when total size is zero', () => {
    expect(cachedPct([s({ id: 'a', bytes: 0, cacheable: true })])).toBe(0);
  });

  it('computes cacheable bytes over total bytes', () => {
    const list = [
      s({ id: 'a', bytes: 100, cacheable: true }),
      s({ id: 'b', bytes: 300, cacheable: false }),
    ];
    expect(cachedPct(list)).toBeCloseTo(0.25, 5);
  });

  it('falls back to chars when bytes are absent', () => {
    const list = [
      s({ id: 'a', chars: 50, cacheable: true }),
      s({ id: 'b', chars: 50, cacheable: false }),
    ];
    expect(cachedPct(list)).toBeCloseTo(0.5, 5);
  });
});

describe('sortSections', () => {
  const list: SectionEntry[] = [
    s({ id: 'a', label: 'Charlie', order: 300, bytes: 100, cacheable: false }),
    s({ id: 'b', label: 'Alpha', order: 100, bytes: 400, cacheable: true }),
    s({ id: 'c', label: 'Bravo', order: 200, bytes: 200, cacheable: false }),
  ];

  it('does not mutate the input', () => {
    const before = list.map((x) => x.id);
    sortSections(list, 'alpha');
    expect(list.map((x) => x.id)).toEqual(before);
  });

  it('sorts by order ascending', () => {
    expect(sortSections(list, 'order').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts cacheable first then by order', () => {
    expect(sortSections(list, 'cached').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts alphabetically by label', () => {
    expect(sortSections(list, 'alpha').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by size descending', () => {
    expect(sortSections(list, 'size').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('orderBand', () => {
  it('bands low orders', () => {
    expect(orderBand(0)).toBe('0–499');
    expect(orderBand(499)).toBe('0–499');
  });

  it('bands mid orders', () => {
    expect(orderBand(500)).toBe('500–999');
    expect(orderBand(999)).toBe('500–999');
  });

  it('bands high orders', () => {
    expect(orderBand(1000)).toBe('1000+');
    expect(orderBand(5000)).toBe('1000+');
  });
});
