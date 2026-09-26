import { describe, expect, it } from 'vitest';
import { visibleTagOptions } from './tag-filter-range';

const dayOf = (iso: string) => iso.slice(0, 10);
const options = [{ id: 'promo' }, { id: 'vip' }, { id: 'model' }, { id: 'unused' }];
const bookings = [
  { start: '2026-09-28T15:00:00', tags: [{ id: 'promo' }] },
  { start: '2026-10-02T09:00:00', tags: [{ id: 'vip' }] },
  { start: '2026-10-05T09:00:00', tags: [{ id: 'model' }] }, // outside
  { start: '2026-09-30T09:00:00', tags: null },
];

describe('visibleTagOptions', () => {
  it('keeps only tags on bookings inside the inclusive range, in option order', () => {
    const out = visibleTagOptions({
      options,
      bookings,
      range: { first: '2026-09-28', last: '2026-10-02' },
      selected: new Set(),
      dayOf,
    });
    expect(out.map((t) => t.id)).toEqual(['promo', 'vip']);
  });

  it('always keeps a selected tag so it can be unchecked', () => {
    const out = visibleTagOptions({
      options,
      bookings,
      range: { first: '2026-09-28', last: '2026-10-02' },
      selected: new Set(['model']),
      dayOf,
    });
    expect(out.map((t) => t.id)).toEqual(['promo', 'vip', 'model']);
  });

  it('offers everything while the range is unknown', () => {
    expect(
      visibleTagOptions({ options, bookings, range: null, selected: new Set(), dayOf }),
    ).toEqual(options);
  });
});
