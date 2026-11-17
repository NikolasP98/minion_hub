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
