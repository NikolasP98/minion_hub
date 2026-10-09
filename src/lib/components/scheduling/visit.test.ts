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
  type VisitMember,
} from './visit';

/** A member with only the fields the helper under test reads. */
const mb = (
  id: string,
  seq: number,
  title: string,
  status: string,
  money: Partial<VisitMember> = {},
): VisitMember => ({
  id,
  seq,
  eventTypeId: `et${seq}`,
  eventTypeTitle: title,
  minutes: 30,
  status,
  paid: false,
  price: null,
  paidAmount: 0,
  currency: null,
  funding: 'cash',
  ticketIds: [],
  referenced: [],
  ...money,
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
        price: null,
        paidAmount: 0,
        currency: null,
        funding: 'cash',
        referenced: [],
      },
    ]);
  });

  it('lists every visit member in seq order, visit already sorted', () => {
    const rows = visitRows({
      visit: {
        groupId: 'g1',
        members: [
          mb('m1', 0, 'Cut', 'accepted', { paid: true, referenced: ['ticket'] }),
          { ...mb('m2', 1, 'Color', 'cancelled'), minutes: 60 },
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
        members: [mb('m1', 0, 'Cut', 'accepted', { paid: true }), mb('m2', 1, 'Color', 'accepted')],
      },
      booking: { id: 'b1', eventTypeId: 'et1', status: 'accepted' },
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: true,
    });
    expect(visitSummary(rows)).toMatchObject({ n: 2, paid: 1, unpaid: 1 });
  });

  it('a cancelled service owes nothing: not unpaid, not pending (same rule as the Charge button)', () => {
    const rows = visitRows({
      visit: {
        groupId: 'g1',
        members: [
          mb('m1', 0, 'Cut', 'accepted', { paid: false, price: 50, currency: 'PEN' }),
          mb('m2', 1, 'Color', 'cancelled', { paid: false, price: 100, currency: 'PEN' }),
          mb('m3', 2, 'Wax', 'no_show', { paid: false, price: null }),
        ],
      },
      booking: { id: 'b1', eventTypeId: 'et1', status: 'accepted' },
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: false,
    });
    expect(visitSummary(rows)).toMatchObject({
      n: 3,
      paid: 0,
      unpaid: 1,
      pendingTotal: 50,
      pendingUnknown: 0,
      currency: 'PEN',
    });
  });

  it('is zero/zero/zero for no rows', () => {
    expect(visitSummary([])).toEqual({
      n: 0,
      paid: 0,
      unpaid: 0,
      paidTotal: 0,
      pendingTotal: 0,
      pendingUnknown: 0,
      currency: null,
    });
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

describe('visitRows money', () => {
  const booking = { id: 'b1', eventTypeId: 'et1', status: 'accepted' };

  it('carries each member its own price, amount, currency and funding', () => {
    const rows = visitRows({
      visit: {
        groupId: 'g1',
        members: [
          mb('m1', 0, 'Cut', 'accepted', {
            paid: true,
            price: 80,
            paidAmount: 80,
            currency: 'PEN',
          }),
          mb('m2', 1, 'Color', 'accepted', { price: 120, currency: 'PEN', funding: 'grant' }),
        ],
      },
      booking,
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: true,
    });
    expect(rows[0]).toMatchObject({ price: 80, paidAmount: 80, currency: 'PEN', funding: 'cash' });
    expect(rows[1]).toMatchObject({ price: 120, paidAmount: 0, funding: 'grant' });
  });

  it('sums the ungrouped booking money from its non-void tickets', () => {
    const [row] = visitRows({
      visit: null,
      booking,
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: true,
      tickets: [
        { status: 'submitted', lineTotal: '80.50', currency: 'PEN' },
        { status: 'submitted', lineTotal: 19.5, currency: 'PEN' },
      ],
    });
    expect(row).toMatchObject({ price: null, paidAmount: 100, currency: 'PEN' });
  });

  it('ignores voided tickets for both the amount and the currency', () => {
    const [row] = visitRows({
      visit: null,
      booking,
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: false,
      tickets: [
        { status: 'voided', lineTotal: '500', currency: 'USD' },
        { status: 'submitted', lineTotal: '60', currency: 'PEN' },
      ],
    });
    expect(row).toMatchObject({ paidAmount: 60, currency: 'PEN' });
  });

  it('is cash with no tickets at all, and takes the booking funding', () => {
    const [cash] = visitRows({
      visit: null,
      booking,
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: false,
    });
    expect(cash).toMatchObject({ paidAmount: 0, currency: null, funding: 'cash' });
    const [plan] = visitRows({
      visit: null,
      booking,
      eventTypeTitle: 'Cut',
      minutes: 30,
      paid: false,
      funding: 'plan',
    });
    expect(plan.funding).toBe('plan');
  });
});

describe('visitSummary money', () => {
  const row = (over: Partial<VisitMember>) =>
    visitRows({
      visit: { groupId: 'g1', members: [mb('m', 0, 'S', 'accepted', over)] },
      booking: { id: 'b1', eventTypeId: 'et1', status: 'accepted' },
      eventTypeTitle: 'S',
      minutes: 30,
      paid: false,
    })[0];

  it('sums what the till took and what the unpaid cash services still owe', () => {
    const s = visitSummary([
      row({ paid: true, price: 80, paidAmount: 80, currency: 'PEN' }),
      row({ price: 120, currency: 'PEN' }),
    ]);
    expect(s).toEqual({
      n: 2,
      paid: 1,
      unpaid: 1,
      paidTotal: 80,
      pendingTotal: 120,
      pendingUnknown: 0,
      currency: 'PEN',
    });
  });

  it('counts an unpaid cash service with no price instead of guessing one', () => {
    const s = visitSummary([
      row({ price: null, currency: 'PEN' }),
      row({ price: 50, currency: 'PEN' }),
    ]);
    expect(s).toMatchObject({ pendingTotal: 50, pendingUnknown: 1 });
  });

  it('owes nothing for a grant-drawn service, priced or not', () => {
    const s = visitSummary([
      row({ funding: 'grant', price: 200, currency: 'PEN' }),
      row({ funding: 'grant', price: null, currency: 'PEN' }),
    ]);
    expect(s).toMatchObject({ pendingTotal: 0, pendingUnknown: 0, unpaid: 2 });
  });

  it('leaves an instalment-plan service out of pending — the plan carries its own remaining', () => {
    const s = visitSummary([
      row({ funding: 'plan', price: 300, currency: 'PEN' }),
      row({ price: 40, currency: 'PEN' }),
    ]);
    expect(s).toMatchObject({ pendingTotal: 40, pendingUnknown: 0 });
  });

  it('never sums two currencies — mixed reads as no currency at all', () => {
    const s = visitSummary([
      row({ paid: true, paidAmount: 80, currency: 'PEN' }),
      row({ price: 30, currency: 'USD' }),
    ]);
    expect(s.currency).toBeNull();
    expect(s.paidTotal).toBe(80);
  });

  it('has no currency when no service knows one', () => {
    expect(visitSummary([row({}), row({})]).currency).toBeNull();
  });
});
