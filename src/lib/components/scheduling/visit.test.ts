import { describe, expect, it } from 'vitest';
import { canRemoveService, nextOrder, visitRows, visitSummary } from './visit';

describe('visitRows', () => {
  const booking = { id: 'b1', eventTypeId: 'et1', status: 'accepted' };

  it('stands the booking in as its only service when there is no visit', () => {
    const rows = visitRows({
      visit: null,
      booking,
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: true,
    });
    expect(rows).toEqual([
      { id: 'b1', eventTypeId: 'et1', title: 'Cut', minutes: 30, status: 'accepted', paid: true, referenced: [] },
    ]);
  });

  it('lists every visit member in seq order, visit already sorted', () => {
    const rows = visitRows({
      visit: {
        groupId: 'g1',
        members: [
          { id: 'm1', seq: 0, eventTypeId: 'et1', eventTypeTitle: 'Cut', minutes: 30, status: 'accepted', paid: true, referenced: ['ticket'] },
          { id: 'm2', seq: 1, eventTypeId: 'et2', eventTypeTitle: 'Color', minutes: 60, status: 'cancelled', paid: false, referenced: [] },
        ],
      },
      booking,
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: true,
    });
    expect(rows.map((r) => r.id)).toEqual(['m1', 'm2']);
    expect(rows[0].referenced).toEqual(['ticket']);
    expect(rows[1].status).toBe('cancelled');
  });
});

describe('visitSummary', () => {
  it('counts paid vs unpaid out of n', () => {
    const rows = visitRows({
      visit: {
        groupId: 'g1',
        members: [
          { id: 'm1', seq: 0, eventTypeId: 'et1', eventTypeTitle: 'Cut', minutes: 30, status: 'accepted', paid: true, referenced: [] },
          { id: 'm2', seq: 1, eventTypeId: 'et2', eventTypeTitle: 'Color', minutes: 60, status: 'accepted', paid: false, referenced: [] },
        ],
      },
      booking: { id: 'b1', eventTypeId: 'et1', status: 'accepted' },
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: true,
    });
    expect(visitSummary(rows)).toEqual({ n: 2, paid: 1, unpaid: 1 });
  });

  it('is zero/zero/zero for no rows', () => {
    expect(visitSummary([])).toEqual({ n: 0, paid: 0, unpaid: 0 });
  });
});

describe('canRemoveService', () => {
  it('allows removal with no references', () => {
    expect(canRemoveService([])).toBe(true);
  });

  it('blocks removal with any reference', () => {
    expect(canRemoveService(['ticket'])).toBe(false);
    expect(canRemoveService(['accrual'])).toBe(false);
  });
});

describe('nextOrder', () => {
  it('swaps with the next id moving down', () => {
    expect(nextOrder(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('swaps with the previous id moving up', () => {
    expect(nextOrder(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op past either edge', () => {
    const ids = ['a', 'b', 'c'];
    expect(nextOrder(ids, 0, -1)).toBe(ids);
    expect(nextOrder(ids, 2, 1)).toBe(ids);
  });
});
