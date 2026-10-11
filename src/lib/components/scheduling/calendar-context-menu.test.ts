import { describe, expect, it } from 'vitest';
import { calendarMenuEntries, type EventMenuDetail } from './calendar-context-menu';
import type { VisitMember } from './visit';

const member = (over: Partial<VisitMember> & { id: string }): VisitMember => ({
  seq: 0,
  eventTypeId: `et-${over.id}`,
  eventTypeTitle: `Service ${over.id}`,
  minutes: 30,
  status: 'accepted',
  paid: false,
  price: 100,
  paidAmount: 0,
  currency: 'PEN',
  funding: 'cash',
  ticketIds: [],
  referenced: [],
  ...over,
});

const detail = (over: Partial<EventMenuDetail> = {}): EventMenuDetail => ({
  booking: {
    id: 'b1',
    status: 'accepted',
    title: 'Botox',
    eventTypeId: 'et-1',
    productId: 'prod-1',
    partyId: 'p1',
    startTime: '2026-10-10T15:00:00.000Z',
    endTime: '2026-10-10T15:30:00.000Z',
    attendeeName: 'Ana',
    attendeePhone: null,
  },
  eventType: { title: 'Botox' },
  contact: null,
  grant: null,
  plan: null,
  tickets: [],
  visit: null,
  products: [],
  ...over,
});

const kinds = (d: EventMenuDetail | null, caps = { canPay: true, canEdit: true }) =>
  calendarMenuEntries({ detail: d, ...caps }).map((e) => e.kind);

describe('calendarMenuEntries', () => {
  it('shows one disabled row while the detail fetch is in flight', () => {
    const entries = calendarMenuEntries({ detail: null, canPay: true, canEdit: true });
    expect(entries).toEqual([{ id: 'loading', kind: 'loading', disabled: true }]);
  });

  it('offers charge + delete for an unpaid single-service event', () => {
    expect(kinds(detail())).toEqual(['charge', 'delete']);
  });

  it('offers no split for a single-service event', () => {
    expect(kinds(detail())).not.toContain('split');
  });

  it('nests Split all + one entry per service, in visit order', () => {
    const d = detail({
      visit: {
        groupId: 'g1',
        members: [
          member({ id: 'b1', seq: 0 }),
          member({ id: 'b2', seq: 1, eventTypeTitle: 'Peeling' }),
          member({ id: 'b3', seq: 2, eventTypeTitle: 'Limpieza' }),
        ],
      },
    });
    const split = calendarMenuEntries({ detail: d, canPay: true, canEdit: true }).find(
      (e) => e.kind === 'split',
    );
    expect(split?.children?.map((c) => [c.kind, c.bookingId, c.title])).toEqual([
      ['splitAll', undefined, undefined],
      ['splitOne', 'b1', 'Service b1'],
      ['splitOne', 'b2', 'Peeling'],
      ['splitOne', 'b3', 'Limpieza'],
    ]);
  });

  it('turns Delete into Unschedule as soon as ONE service is paid-linked', () => {
    const d = detail({
      visit: {
        groupId: 'g1',
        members: [member({ id: 'b1', paid: true, paidAmount: 100 }), member({ id: 'b2', seq: 1 })],
      },
    });
    expect(kinds(d)).toEqual(['charge', 'split', 'unschedule']);
  });

  it('drops charge once every service is paid, keeping unschedule', () => {
    const d = detail({
      visit: {
        groupId: 'g1',
        members: [
          member({ id: 'b1', paid: true, paidAmount: 100 }),
          member({ id: 'b2', seq: 1, paid: true, paidAmount: 100 }),
        ],
      },
    });
    expect(kinds(d)).toEqual(['split', 'unschedule']);
  });

  it('offers nothing destructive when every service is already closed', () => {
    const d = detail({
      booking: { ...detail().booking, status: 'cancelled' },
      visit: {
        groupId: 'g1',
        members: [
          member({ id: 'b1', status: 'cancelled' }),
          member({ id: 'b2', seq: 1, status: 'no_show' }),
        ],
      },
    });
    expect(kinds(d)).toEqual(['split']);
  });

  it('does not offer charge for a grant-funded service (the package pays it)', () => {
    expect(kinds(detail({ grant: { id: 'g' } }))).toEqual(['delete']);
  });

  it('offers charge for an open instalment plan even with nothing left to sell', () => {
    const d = detail({ plan: { plan: { id: 'pl-1' }, isPaid: false } });
    expect(kinds(d)).toEqual(['charge', 'delete']);
  });

  it('offers no charge for a fully paid instalment plan', () => {
    const d = detail({ plan: { plan: { id: 'pl-1' }, isPaid: true } });
    expect(kinds(d)).toEqual(['delete']);
  });

  it('reads a VOIDED ticket as not paid, so the event keeps its charge entry', () => {
    const d = detail({ tickets: [{ status: 'voided', lineTotal: '100', currency: 'PEN' }] });
    expect(kinds(d)).toEqual(['charge', 'delete']);
  });

  it('withholds charge without pay capability and mutations without edit capability', () => {
    const d = detail({
      visit: { groupId: 'g1', members: [member({ id: 'b1' }), member({ id: 'b2', seq: 1 })] },
    });
    expect(kinds(d, { canPay: false, canEdit: true })).toEqual(['split', 'delete']);
    expect(kinds(d, { canPay: true, canEdit: false })).toEqual(['charge']);
    expect(kinds(d, { canPay: false, canEdit: false })).toEqual([]);
  });

  it('marks only the destructive entry as danger', () => {
    const entries = calendarMenuEntries({ detail: detail(), canPay: true, canEdit: true });
    expect(entries.map((e) => [e.kind, e.danger ?? false])).toEqual([
      ['charge', false],
      ['delete', true],
    ]);
  });
});
