import { describe, expect, it } from 'vitest';
import {
  decodeRecoveryFacet,
  decodeSoldFacet,
  soldRows,
  soldRowsForVisit,
  type SoldLineRecord,
} from './booking-product-facets';

const line = (over: Partial<SoldLineRecord>): SoldLineRecord => ({
  ticketId: 't1',
  ticketHumanId: 'POS-1',
  lineId: 'l1',
  productId: 'p1',
  bookingId: null,
  description: 'Faja M',
  qty: 1,
  total: 0,
  ...over,
});
const visit = { anchorId: 'a', memberIds: new Set(['a', 'b']) };

describe('soldRowsForVisit — spec 126 relation table', () => {
  it('keeps the unassigned zero-total Faja M, labelled as co-ticket, with the gift flag', () => {
    const f = soldRowsForVisit([line({})], visit, true);
    expect(soldRows(f)).toMatchObject([{ relation: 'co_ticket_unassigned', gift: true, qty: 1 }]);
  });

  it('classifies direct and group, and excludes a booking outside the visit', () => {
    const f = soldRowsForVisit(
      [
        line({ lineId: 'l1', bookingId: 'a' }),
        line({ lineId: 'l2', bookingId: 'b' }),
        line({ lineId: 'l3', bookingId: 'other-visit' }),
      ],
      visit,
      true,
    );
    expect(soldRows(f).map((r) => [r.lineId, r.relation])).toEqual([
      ['l1', 'direct'],
      ['l2', 'group'],
    ]);
  });

  it('dedupes by (ticketId, lineId), keeping two lines with the same description', () => {
    const f = soldRowsForVisit(
      [line({ lineId: 'l1' }), line({ lineId: 'l1' }), line({ lineId: 'l2' })],
      visit,
      true,
    );
    expect(soldRows(f)).toHaveLength(2);
  });

  it('sends gift null (never false) when financial fields are not admitted', () => {
    const f = soldRowsForVisit(
      [line({ total: 0 }), line({ lineId: 'l2', total: 90 })],
      visit,
      false,
    );
    expect(soldRows(f).map((r) => r.gift)).toEqual([null, null]);
    expect(JSON.stringify(f)).not.toContain('total');
  });

  it('is empty (not unavailable) when every line is outside the visit', () => {
    expect(soldRowsForVisit([line({ bookingId: 'x' })], visit, true)).toEqual({ state: 'empty' });
  });
});

describe('decodeSoldFacet', () => {
  it('round-trips an available facet and the closed states', () => {
    const f = soldRowsForVisit([line({})], visit, true);
    expect(decodeSoldFacet(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(decodeSoldFacet({ state: 'denied' })).toEqual({ state: 'denied' });
    expect(decodeSoldFacet({ state: 'empty' })).toEqual({ state: 'empty' });
    expect(decodeSoldFacet({ state: 'unavailable', reason: 'not_in_slice' })).toEqual({
      state: 'unavailable',
      reason: 'not_in_slice',
    });
  });

  it('turns missing, unknown-reason and malformed input into unavailable, never empty', () => {
    const bad = { state: 'unavailable', reason: 'invalid_projection' };
    expect(decodeSoldFacet(undefined)).toEqual(bad);
    expect(decodeSoldFacet({ state: 'unavailable', reason: 'nope' })).toEqual(bad);
    expect(decodeSoldFacet({ state: 'available', value: { rows: [{ ticketId: 1 }] } })).toEqual(
      bad,
    );
    expect(decodeSoldFacet({ state: 'available', value: { rows: [] } })).toEqual(bad);
  });
});

describe('decodeRecoveryFacet', () => {
  const row = (accrualId: string) => ({
    accrualId,
    itemId: `i-${accrualId}`,
    itemName: 'Serum',
    uom: 'bottle',
    consumptionUom: 'ml',
    unitsPerStockUom: 50,
    subunitsPerStockUom: null,
    diagramEnabled: false,
    qty: 0.2,
    qtyConsumption: 10,
  });
  const member = (over: Record<string, unknown> = {}) => ({
    bookingId: 'm1',
    status: 'completed',
    openCount: 1,
    realizedCount: 0,
    releasedCount: 0,
    sourceEntry: null,
    eligibility: 'confirm_open',
    confirmation: {
      state: 'available',
      value: { openCount: 1, rows: [row('a1')], expectedOpenFingerprint: 'a'.repeat(64) },
    },
    ...over,
  });
  const bad = { state: 'unavailable', reason: 'invalid_projection' };

  it('accepts a complete confirm_open member and the closed states', () => {
    expect(decodeRecoveryFacet({ state: 'available', value: [member()] }).state).toBe('available');
    expect(decodeRecoveryFacet({ state: 'denied' })).toEqual({ state: 'denied' });
    expect(decodeRecoveryFacet({ state: 'empty' })).toEqual({ state: 'empty' });
    expect(decodeRecoveryFacet({ state: 'unavailable', reason: 'capacity' })).toEqual({
      state: 'unavailable',
      reason: 'capacity',
    });
  });

  it.each([
    ['missing', undefined],
    ['unknown reason', { state: 'unavailable', reason: 'open_rows_overflow' }],
    [
      'a duplicate accrual id (not constructible in PostgreSQL, so a decoder vector)',
      {
        state: 'available',
        value: [
          member({
            openCount: 2,
            confirmation: {
              state: 'available',
              value: {
                openCount: 2,
                rows: [row('a1'), row('a1')],
                expectedOpenFingerprint: 'a'.repeat(64),
              },
            },
          }),
        ],
      },
    ],
    [
      'a count that disagrees with the rows',
      {
        state: 'available',
        value: [member({ openCount: 3 })],
      },
    ],
    [
      'a short fingerprint',
      {
        state: 'available',
        value: [
          member({
            confirmation: {
              state: 'available',
              value: { openCount: 1, rows: [row('a1')], expectedOpenFingerprint: 'abc' },
            },
          }),
        ],
      },
    ],
    [
      'confirm_open without its open set',
      { state: 'available', value: [member({ confirmation: null })] },
    ],
    [
      'an unknown eligibility',
      { state: 'available', value: [member({ eligibility: 'retry_all' })] },
    ],
    ['an empty available list', { state: 'available', value: [] }],
  ])('rejects %s as unavailable, never as nothing to recover', (_n, input) => {
    expect(decodeRecoveryFacet(input)).toEqual(bad);
  });
});

// ── versioned envelope (spec 126 wire) ───────────────────────────────────────
import { basicMember, facetsOf } from './__fixtures__/detail-wire';
import {
  availableTicketOverlayRows,
  decodeBookingCalendarProjection,
  decodeBookingDetailWire,
  decodeCalendarFacets,
  decodeProductFacets,
  financialVisitRows,
  paymentReady,
  visitAnchorIdFromFacets,
  type BookingProductFacets,
} from './booking-product-facets';

const wire = (f: BookingProductFacets) => JSON.parse(JSON.stringify(f));

describe('decodeProductFacets', () => {
  it('round-trips a complete envelope and keeps each facet independent', () => {
    const f = facetsOf([basicMember('a'), basicMember('b', 1)], {}, 'g1');
    expect(decodeProductFacets(wire(f))).toEqual(f);
  });

  it.each([[undefined], [{}], [{ version: 2 }], [{ version: 1 }]])(
    'refuses a missing or other version (%o) as a whole (old protocol: refresh)',
    (input) => {
      const out = decodeProductFacets(input);
      // version 1 with no facets decodes to per-facet unavailable, never to empty/available
      if (out) {
        expect(out.basic.state).toBe('unavailable');
        expect(out.payment.state).toBe('unavailable');
      } else expect(out).toBeNull();
      if (
        !(input as { version?: number } | undefined)?.version ||
        (input as { version: number }).version !== 1
      )
        expect(out).toBeNull();
    },
  );

  it('a malformed facet is unavailable on its own; the others survive', () => {
    const raw = wire(facetsOf([basicMember('a')]));
    raw.payment = { state: 'available', value: { services: [{ bookingId: 'a' }] } };
    const out = decodeProductFacets(raw)!;
    expect(out.payment).toEqual({ state: 'unavailable', reason: 'invalid_projection' });
    expect(out.basic.state).toBe('available');
  });

  it('rejects more than 8 members, duplicate ids, and an anchor that is not the first member', () => {
    const many = Array.from({ length: 9 }, (_, i) => basicMember(`m${i}`, i));
    expect(decodeProductFacets(wire(facetsOf(many)))!.basic.state).toBe('unavailable');
    const dup = wire(facetsOf([basicMember('a'), basicMember('a', 1)]));
    expect(decodeProductFacets(dup)!.basic.state).toBe('unavailable');
    const anchor = wire(facetsOf([basicMember('a'), basicMember('b', 1)]));
    anchor.basic.value.anchorId = 'b';
    expect(decodeProductFacets(anchor)!.basic.state).toBe('unavailable');
  });

  it('the stock-cost facet is a closed non-value union', () => {
    const raw = wire(facetsOf([basicMember('a')]));
    for (const bad of [
      { state: 'unavailable', reason: 'valuation_currency_unverified', estValue: 5 },
      { state: 'available', value: 0 },
      { state: 'empty', currency: 'USD' },
    ]) {
      const r = structuredClone(raw);
      r.payment.value.accrualCost = bad;
      expect(decodeProductFacets(r)!.payment.state).toBe('unavailable');
    }
    const ok = structuredClone(raw);
    ok.payment.value.accrualCost = {
      state: 'unavailable',
      reason: 'valuation_currency_unverified',
    };
    expect(decodeProductFacets(ok)!.payment.state).toBe('available');
  });

  it('a void or voided ticket never decodes', () => {
    const raw = wire(facetsOf([basicMember('a')]));
    const t = {
      ticketId: 't',
      humanId: null,
      submittedAt: null,
      status: 'voided',
      currency: 'PEN',
      lineTotal: '1',
      subtotal: '1',
      discount: '0',
      total: '1',
      note: null,
      payments: [],
      otherLines: [],
      lineCount: 1,
      emission: null,
      createdByName: null,
      invoiceId: null,
    };
    raw.payment.value.tickets = [t];
    expect(decodeProductFacets(raw)!.payment.state).toBe('unavailable');
    raw.payment.value.tickets = [{ ...t, status: 'submitted' }];
    expect(decodeProductFacets(raw)!.payment.state).toBe('available');
  });
});

describe('financialVisitRows', () => {
  const money = (f: BookingProductFacets) => financialVisitRows(f);
  const rowOf = (f: BookingProductFacets, id: string) => {
    const r = money(f);
    return r.state === 'available' ? r.value.rows.find((x) => x.id === id) : undefined;
  };

  it('joins structure and money; keeps a real 0 paid amount, a real free price 0 and an unknown price null', () => {
    const f = facetsOf([basicMember('a'), basicMember('b', 1)], {}, 'g');
    if (f.payment.state !== 'available') throw new Error('fixture');
    f.payment.value.services[0] = { ...f.payment.value.services[0]!, price: 0, paidAmount: 0 };
    f.payment.value.services[1] = { ...f.payment.value.services[1]!, price: null };
    expect(rowOf(f, 'a')).toMatchObject({
      price: 0,
      paidAmount: 0,
      paid: false,
      title: 'Consulta',
    });
    expect(rowOf(f, 'b')!.price).toBeNull();
    expect(rowOf(f, 'a')).not.toHaveProperty('referenced');
  });

  it.each([
    ['denied payment', { payment: { state: 'denied' } }, 'denied'],
    [
      'unavailable payment',
      { payment: { state: 'unavailable', reason: 'read_failed' } },
      'unavailable',
    ],
    ['empty payment for a nonempty visit', { payment: { state: 'empty' } }, 'unavailable'],
    [
      'unavailable planned',
      { planned: { state: 'unavailable', reason: 'read_failed' } },
      'unavailable',
    ],
    ['denied basic', { basic: { state: 'denied' } }, 'denied'],
  ])('%s never yields rows', (_n, over, state) => {
    const out = money(facetsOf([basicMember('a')], over as never));
    expect(out.state).toBe(state);
    expect(out).not.toHaveProperty('value');
  });

  it('a service row for an unknown booking, a missing member row or a planned mismatch is invalid_projection', () => {
    const f = facetsOf([basicMember('a'), basicMember('b', 1)], {}, 'g');
    if (f.payment.state !== 'available') throw new Error('fixture');
    f.payment.value.services[1]!.bookingId = 'zzz';
    expect(money(f)).toEqual({ state: 'unavailable', reason: 'invalid_projection' });
    const g = facetsOf([basicMember('a')], {
      planned: { state: 'available', value: { rows: [{ productId: 'p', name: 'X', qty: 1 }] } },
    });
    expect(money(g)).toEqual({ state: 'unavailable', reason: 'invalid_projection' });
  });
});

describe('visitAnchorIdFromFacets / calendar projection / overlay', () => {
  it('anchors only from a validated basic facet', () => {
    expect(visitAnchorIdFromFacets(facetsOf([basicMember('a')]))).toBe('a');
    expect(
      visitAnchorIdFromFacets(facetsOf([basicMember('a')], { basic: { state: 'denied' } })),
    ).toBeNull();
    expect(visitAnchorIdFromFacets(null)).toBeNull();
  });

  it('decodeBookingDetailWire refuses an envelope without the version', () => {
    expect(decodeBookingDetailWire({ booking: {}, productFacets: { version: 1 } })).not.toBeNull();
    expect(decodeBookingDetailWire({ booking: {}, tickets: [] })).toBeNull();
  });

  const proj = (over: Record<string, unknown> = {}) => ({
    productProjectionVersion: 1,
    bookings: [],
    tagOptions: [],
    ticketOverlay: { state: 'empty' },
    ...over,
  });
  it('the window decoder refuses an old protocol and any legacy money namespace', () => {
    expect(decodeBookingCalendarProjection(proj())).not.toBeNull();
    expect(decodeBookingCalendarProjection(proj({ productProjectionVersion: 2 }))).toBeNull();
    expect(decodeBookingCalendarProjection(proj({ invoices: [] }))).toBeNull();
    expect(decodeBookingCalendarProjection(proj({ accrualSummaries: [] }))).toBeNull();
    expect(decodeBookingCalendarProjection({ bookings: [], tagOptions: [] })).toBeNull();
  });

  it('the overlay is a facet: malformed rows, duplicate ids and a missing key are unavailable, not []', () => {
    const row = {
      id: 't',
      humanId: null,
      at: '2026-09-08T14:00:00Z',
      total: 5,
      currency: 'PEN',
      customerName: null,
      lines: [],
    };
    expect(availableTicketOverlayRows({ state: 'available', value: { rows: [row] } }).state).toBe(
      'available',
    );
    for (const bad of [
      undefined,
      { state: 'available', value: { rows: [{ ...row, total: '5' }] } },
      { state: 'available', value: { rows: [row, row] } },
      { state: 'available', value: { rows: [{ ...row, at: 'nope' }] } },
    ])
      expect(availableTicketOverlayRows(bad)).toEqual({
        state: 'unavailable',
        reason: 'invalid_projection',
      });
  });

  it('paymentReady needs an available payment facet on EVERY member', () => {
    const ok = {
      version: 1,
      sold: { state: 'empty' },
      payment: { state: 'available', value: { paid: false, funding: 'cash', tickets: [] } },
      stock: { state: 'denied' },
    };
    expect(decodeCalendarFacets(ok)!.payment.state).toBe('available');
    expect(paymentReady([{ productFacets: ok as never }, { productFacets: ok as never }])).toBe(
      true,
    );
    expect(paymentReady([{ productFacets: ok as never }, {}])).toBe(false);
    expect(paymentReady([])).toBe(false);
    expect(
      paymentReady([
        { productFacets: { ...ok, payment: { state: 'available', value: { paid: 1 } } } as never },
      ]),
    ).toBe(false);
  });
});
