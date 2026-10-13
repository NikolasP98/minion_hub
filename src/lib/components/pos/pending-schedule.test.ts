import { describe, expect, it } from 'vitest';
import { matchEventTypes, sequentialSlots } from './pending-schedule';

/** Owner bug (2026-10-10): dropping/picking a paid-but-unscheduled line opened
 *  the create tray completely empty instead of booking straight through, or
 *  (on a conflict) opening the tray prefilled. Root cause: the fallback path
 *  always carried `ticketId`/`lineId` but dropped the line's customer and
 *  resolved service before this fix — see `+page.svelte`'s `pickTime`. This
 *  proves the ONE piece of non-trivial logic the fallback branches on. */
describe('matchEventTypes', () => {
  const types = [
    { id: 'e1', active: true, productId: 'p1' },
    { id: 'e2', active: false, productId: 'p1' },
    { id: 'e3', active: true, productId: 'p2' },
    { id: 'e4', active: true, productId: 'p2' },
  ];

  it('is empty when the line carries no product', () => {
    expect(matchEventTypes({ finProductId: null }, types)).toEqual([]);
  });

  it('resolves exactly one ACTIVE event type for an unambiguous product — the direct-book case', () => {
    expect(matchEventTypes({ finProductId: 'p1' }, types)).toEqual([types[0]]);
  });

  it('returns every active match when a product maps to more than one service — ambiguous, falls back', () => {
    expect(matchEventTypes({ finProductId: 'p2' }, types)).toEqual([types[2], types[3]]);
  });

  it('is empty when every event type mapped to the product is inactive', () => {
    expect(matchEventTypes({ finProductId: 'p1' }, [types[1]])).toEqual([]);
  });

  it('is empty for a product nothing maps to', () => {
    expect(matchEventTypes({ finProductId: 'p9' }, types)).toEqual([]);
  });
});

describe('sequentialSlots', () => {
  it('starts each service where the previous one ends', () => {
    expect(sequentialSlots(9 * 60 + 30, [30, 45, 60])).toEqual(['09:30', '10:00', '10:45']);
  });

  it('pads the hour and the minute', () => {
    expect(sequentialSlots(5, [55, 10])).toEqual(['00:05', '01:00']);
  });

  it('stops before midnight instead of spilling into the next day', () => {
    expect(sequentialSlots(23 * 60, [45, 45, 45])).toEqual(['23:00', '23:45']);
  });

  it('is empty for an empty group', () => {
    expect(sequentialSlots(600, [])).toEqual([]);
  });
});
