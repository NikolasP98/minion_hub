import { describe, expect, it } from 'vitest';
import {
  canRemoveService,
  nextOrder,
  visitAnchorId,
  visitHeaderStatus,
  visitHeaderTitle,
  visitRows,
  visitSummary,
  servicesTitle,
} from './visit';

/** A member with only the fields the helper under test reads. */
const mb = (id: string, seq: number, title: string, status: string) => ({
  id,
  seq,
  eventTypeId: `et${seq}`,
  eventTypeTitle: title,
  minutes: 30,
  status,
  paid: false,
  referenced: [],
});

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
      {
        id: 'b1',
        eventTypeId: 'et1',
        title: 'Cut',
        minutes: 30,
        status: 'accepted',
        paid: true,
        referenced: [],
      },
    ]);
  });

  it('lists every visit member in seq order, visit already sorted', () => {
    const rows = visitRows({
      visit: {
        groupId: 'g1',
        members: [
          {
            id: 'm1',
            seq: 0,
            eventTypeId: 'et1',
            eventTypeTitle: 'Cut',
            minutes: 30,
            status: 'accepted',
            paid: true,
            referenced: ['ticket'],
          },
          {
            id: 'm2',
            seq: 1,
            eventTypeId: 'et2',
            eventTypeTitle: 'Color',
            minutes: 60,
            status: 'cancelled',
            paid: false,
            referenced: [],
          },
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
          {
            id: 'm1',
            seq: 0,
            eventTypeId: 'et1',
            eventTypeTitle: 'Cut',
            minutes: 30,
            status: 'accepted',
            paid: true,
            referenced: [],
          },
          {
            id: 'm2',
            seq: 1,
            eventTypeId: 'et2',
            eventTypeTitle: 'Color',
            minutes: 60,
            status: 'accepted',
            paid: false,
            referenced: [],
          },
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

describe('visitAnchorId', () => {
  it('is null with nothing loaded', () => {
    expect(visitAnchorId(null)).toBeNull();
  });

  it('is the booking itself when it has no visit', () => {
    expect(visitAnchorId({ booking: { id: 'b1' }, visit: null })).toBe('b1');
  });

  it('is the lead member when the drawer opened on a non-lead service', () => {
    expect(
      visitAnchorId({
        booking: { id: 'm2' },
        visit: {
          groupId: 'g1',
          members: [mb('m1', 0, 'Cut', 'accepted'), mb('m2', 1, 'Color', 'accepted')],
        },
      }),
    ).toBe('m1');
  });

  it('is the lead even when the lead is the cancelled one', () => {
    expect(
      visitAnchorId({
        booking: { id: 'm2' },
        visit: {
          groupId: 'g1',
          members: [mb('m1', 0, 'Cut', 'cancelled'), mb('m2', 1, 'Color', 'accepted')],
        },
      }),
    ).toBe('m1');
  });
});

describe('visitHeaderTitle', () => {
  it('is null for a single-service event, so the drawer keeps its own title', () => {
    expect(visitHeaderTitle([])).toBeNull();
    expect(visitHeaderTitle([mb('m1', 0, 'Cut', 'accepted')])).toBeNull();
  });

  it('joins every service in visit order, cancelled ones included', () => {
    expect(
      visitHeaderTitle([
        mb('m1', 0, 'Cut', 'cancelled'),
        mb('m2', 1, 'Color', 'accepted'),
        mb('m3', 2, 'Blowdry', 'accepted'),
      ]),
    ).toBe('Cut · Color · Blowdry');
  });
});

describe('visitHeaderStatus', () => {
  it('falls back to the booking status with no visit', () => {
    expect(visitHeaderStatus([], 'pending')).toBe('pending');
  });

  it('is the only member status for a one-service visit', () => {
    expect(visitHeaderStatus([mb('m1', 0, 'Cut', 'completed')], 'completed')).toBe('completed');
  });

  it('is the first ACTIVE member, not the cancelled lead', () => {
    expect(
      visitHeaderStatus(
        [
          mb('m1', 0, 'Cut', 'cancelled'),
          mb('m2', 1, 'Color', 'pending'),
          mb('m3', 2, 'Blowdry', 'accepted'),
        ],
        'cancelled',
      ),
    ).toBe('pending');
  });

  it('is the lead when every member is inactive', () => {
    expect(
      visitHeaderStatus(
        [mb('m1', 0, 'Cut', 'no_show'), mb('m2', 1, 'Color', 'cancelled')],
        'no_show',
      ),
    ).toBe('no_show');
  });
});

describe('servicesTitle', () => {
  const titleOf = (id: string) => ({ e1: 'Cut', e2: 'Color', e3: 'Blowdry' })[id] ?? '—';

  it('joins every service of a multi-service event, in the order given', () => {
    expect(
      servicesTitle([{ eventTypeId: 'e1' }, { eventTypeId: 'e2' }, { eventTypeId: 'e3' }], titleOf),
    ).toBe('Cut · Color · Blowdry');
  });

  it('is the single service own title for a one-service event', () => {
    expect(servicesTitle([{ eventTypeId: 'e2' }], titleOf)).toBe('Color');
  });

  it('falls back to the resolver for an unknown event type, and survives no members', () => {
    expect(servicesTitle([{ eventTypeId: 'nope' }], titleOf)).toBe('—');
    expect(servicesTitle([], titleOf)).toBe('—');
  });
});
