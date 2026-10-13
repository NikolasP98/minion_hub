import { describe, expect, it } from 'vitest';
import { calendarMenuEntries, cancelPaidTickets } from './calendar-context-menu';
import type { CalendarBooking } from './calendar-window';

const member = (over: Partial<CalendarBooking> & { id: string }): CalendarBooking => ({
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

const kinds = (b: { members: CalendarBooking[] }, caps = { canPay: true, canEdit: true }) =>
  calendarMenuEntries({ box: b, ...caps }).map((e) => e.kind);

describe('calendarMenuEntries', () => {
  it('offers charge + delete for an unpaid single-service event, synchronously', () => {
    expect(kinds(box(member({ id: 'b1' })))).toEqual(['charge', 'delete']);
  });

  it('offers no split for a single-service event', () => {
    expect(kinds(box(member({ id: 'b1' })))).not.toContain('split');
  });

  it('nests Split all + one entry per service, in visit order', () => {
    const b = box(member({ id: 'b1' }), member({ id: 'b2' }), member({ id: 'b3' }));
    const split = calendarMenuEntries({ box: b, canPay: true, canEdit: true }).find(
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

  it('reads a missing paid/funding flag as unpaid cash (scheduling calendar payload)', () => {
    const b = box(member({ id: 'b1', paid: undefined, funding: undefined }));
    expect(kinds(b)).toEqual(['charge', 'delete']);
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
    });
    expect(entries.map((e) => [e.kind, e.danger ?? false])).toEqual([
      ['charge', false],
      ['delete', true],
    ]);
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
