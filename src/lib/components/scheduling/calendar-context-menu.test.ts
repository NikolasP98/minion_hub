import { describe, expect, it } from 'vitest';
import { calendarMenuEntries, cancelPaidTickets, voidRefusalKey } from './calendar-context-menu';
import type { CalendarBooking } from './calendar-window';

/** A window row whose payment facet is AVAILABLE and agrees with its paid/funding/tickets aliases. */
const member = (over: Partial<CalendarBooking> & { id: string }): CalendarBooking => {
  const row = base(over);
  return {
    ...row,
    productFacets: over.productFacets ?? {
      version: 1,
      sold: { state: 'empty' },
      payment: {
        state: 'available',
        value: { paid: !!row.paid, funding: row.funding ?? 'cash', tickets: row.tickets ?? [] },
      },
      stock: { state: 'unavailable', reason: 'not_in_slice' },
    },
  };
};
const base = (over: Partial<CalendarBooking> & { id: string }): CalendarBooking => ({
  resourceId: 'r1',
  eventTypeId: `et-${over.id}`,
  start: '2026-10-10T15:00:00.000Z',
  end: '2026-10-10T15:30:00.000Z',
  status: 'accepted',
  attendeeName: 'Ana',
  paid: false,
  funding: 'cash',
  tickets: [],
  ...over,
});

const box = (...members: CalendarBooking[]) => ({ members });

const kinds = (
  b: { members: CalendarBooking[] },
  caps: Partial<{ canPay: boolean; canEdit: boolean; canVoid: boolean }> = {},
) =>
  calendarMenuEntries({ box: b, canPay: true, canEdit: true, canVoid: true, ...caps }).map(
    (e) => e.kind,
  );

describe('calendarMenuEntries', () => {
  it('offers charge + delete for an unpaid single-service event, synchronously', () => {
    expect(kinds(box(member({ id: 'b1' })))).toEqual(['charge', 'delete']);
  });

  it('offers no split for a single-service event', () => {
    expect(kinds(box(member({ id: 'b1' })))).not.toContain('split');
  });

  it('nests Split all + one entry per service, in visit order', () => {
    const b = box(member({ id: 'b1' }), member({ id: 'b2' }), member({ id: 'b3' }));
    const split = calendarMenuEntries({ box: b, canPay: true, canEdit: true, canVoid: true }).find(
      (e) => e.kind === 'split',
    );
    expect(split?.children?.map((c) => [c.kind, c.bookingId])).toEqual([
      ['splitAll', undefined],
      ['splitOne', 'b1'],
      ['splitOne', 'b2'],
      ['splitOne', 'b3'],
    ]);
  });

  it('turns Delete into Cancel-paid as soon as ONE service is paid', () => {
    const b = box(member({ id: 'b1', paid: true }), member({ id: 'b2' }));
    expect(kinds(b)).toEqual(['charge', 'split', 'cancel-paid']);
  });

  it('drops charge once every service is paid, keeping cancel-paid', () => {
    const b = box(member({ id: 'b1', paid: true }), member({ id: 'b2', paid: true }));
    expect(kinds(b)).toEqual(['split', 'cancel-paid']);
  });

  it('offers ONLY detail when every service is closed (never an empty menu)', () => {
    const b = box(
      member({ id: 'b1', status: 'cancelled' }),
      member({ id: 'b2', status: 'no_show' }),
    );
    expect(kinds(b)).toEqual(['detail']);
    expect(kinds(b, { canPay: false, canEdit: false })).toEqual(['detail']);
  });

  it('offers ONLY detail when every service is COMPLETED (performed work stays)', () => {
    const b = box(member({ id: 'b1', status: 'completed', paid: true }));
    expect(kinds(b)).toEqual(['detail']);
  });

  it('does not offer charge for a grant- or plan-funded service', () => {
    expect(kinds(box(member({ id: 'b1', funding: 'grant' })))).toEqual(['delete']);
    expect(kinds(box(member({ id: 'b1', funding: 'plan' })))).toEqual(['delete']);
  });

  it.each([
    ['denied', { state: 'denied' }],
    ['unavailable', { state: 'unavailable', reason: 'read_failed' }],
    ['not in this slice (scheduling calendar)', { state: 'unavailable', reason: 'not_in_slice' }],
    ['malformed', { state: 'available', value: { paid: 'yes' } }],
  ])(
    'never infers unpaid cash from %s payment: no charge, sale, delete or cancel-paid',
    (_n, payment) => {
      const facets = {
        version: 1,
        sold: { state: 'empty' },
        payment,
        stock: { state: 'denied' },
      } as never;
      const open = member({ id: 'b1', productFacets: facets, paid: undefined, funding: undefined });
      const second = member({ id: 'b2', productFacets: facets });
      expect(kinds(box(open))).toEqual(['detail']);
      expect(kinds(box(open, second))).toEqual(['detail', 'split']);
    },
  );

  it('a missing facet (old cached row) is blocked too', () => {
    const row = { ...base({ id: 'b1', paid: true, tickets: [{ id: 't', humanId: null }] }) };
    expect(kinds(box(row))).toEqual(['detail']);
    expect(
      calendarMenuEntries({
        box: box({ ...row, status: 'completed' }),
        canPay: true,
        canEdit: true,
        canVoid: true,
      }).map((e) => e.kind),
    ).toEqual(['detail']);
  });

  it('one blocked member blocks the payment actions of the whole box', () => {
    const blocked = member({
      id: 'b2',
      productFacets: {
        version: 1,
        sold: { state: 'empty' },
        payment: { state: 'denied' },
        stock: { state: 'denied' },
      } as never,
    });
    expect(kinds(box(member({ id: 'b1' }), blocked))).toEqual(['detail', 'split']);
  });

  it('withholds charge without pay capability and mutations without edit capability', () => {
    const b = box(member({ id: 'b1' }), member({ id: 'b2' }));
    expect(kinds(b, { canPay: false, canEdit: true })).toEqual(['split', 'delete']);
    expect(kinds(b, { canPay: true, canEdit: false })).toEqual(['charge']);
    expect(kinds(b, { canPay: false, canEdit: false })).toEqual([]);
  });

  it('marks only the destructive entry as danger', () => {
    const entries = calendarMenuEntries({
      box: box(member({ id: 'b1' })),
      canPay: true,
      canEdit: true,
      canVoid: true,
    });
    expect(entries.map((e) => [e.kind, e.danger ?? false])).toEqual([
      ['charge', false],
      ['delete', true],
    ]);
  });
});

describe('calendarMenuEntries: the sale of a charged visit (spec 120)', () => {
  const sold = { paid: true, tickets: [{ id: 't1', humanId: 'POS-1' }] };

  it('a completed, charged visit offers its sale next to the detail', () => {
    expect(kinds(box(member({ id: 'b1', status: 'completed', ...sold })))).toEqual([
      'detail',
      'sale',
    ]);
  });

  it('an active, charged visit offers its sale before the destructive entry', () => {
    expect(kinds(box(member({ id: 'b1', ...sold })))).toEqual(['sale', 'cancel-paid']);
  });

  it('a visit with no sale does not', () => {
    expect(kinds(box(member({ id: 'b1', status: 'completed' })))).toEqual(['detail']);
  });
});

describe('calendarMenuEntries: void gate', () => {
  it('offers no destructive entry on a paid event when the host cannot void (pos:manage)', () => {
    const b = box(member({ id: 'b1', paid: true }));
    expect(kinds(b, { canVoid: false })).toEqual([]);
    expect(kinds(b, { canVoid: false })).not.toContain('delete');
  });

  it('keeps delete on an unpaid event for a host who cannot void', () => {
    expect(kinds(box(member({ id: 'b1' })), { canVoid: false })).toEqual(['charge', 'delete']);
  });
});

describe('voidRefusalKey', () => {
  it("names the role for a 403 (SvelteKit's {message} body carries no code)", () => {
    expect(voidRefusalKey(403, {})).toBe('forbidden');
  });
  it('names the missing register for no_open_shift', () => {
    expect(voidRefusalKey(409, { code: 'no_open_shift' })).toBe('no_open_shift');
  });
  it('passes every other refusal through', () => {
    expect(voidRefusalKey(409, { code: 'reconciled' })).toBe('other');
    expect(voidRefusalKey(500, {})).toBe('other');
  });
});

describe('cancelPaidTickets', () => {
  it('lists each ticket once, in member order', () => {
    const t1 = { id: 't1', humanId: 'POS-0001' };
    const t2 = { id: 't2', humanId: null };
    expect(
      cancelPaidTickets([
        member({ id: 'b1', tickets: [t1] }),
        member({ id: 'b2', tickets: [t2, t1] }),
        member({ id: 'b3' }),
      ]),
    ).toEqual([t1, t2]);
  });
});
