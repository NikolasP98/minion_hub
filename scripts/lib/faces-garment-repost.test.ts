import { describe, expect, it } from 'vitest';
import {
  decodeGarmentRepostManifestV1,
  garmentManifestSha256,
  isInverseOf,
  planGarmentRepost,
  type GarmentFacts,
} from './faces-garment-repost';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (c: string) => c.repeat(64);
const [ORG, ACTOR, TICKET, LINE, PROD, ENTRY, L, M, WH] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);
const raw = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  kind: 'sale_stock_repost',
  action: 'correct',
  target: { databaseIdentity: H('b'), authProject: 'p', authUrl: 'https://auth.example.org' },
  sourceCodeSha: 'a'.repeat(40),
  operationKey: id(20),
  orgId: ORG,
  actorProfileId: ACTOR,
  ticketId: TICKET,
  ticketLineId: LINE,
  productId: PROD,
  originalEntryId: ENTRY,
  fromItemId: L,
  toItemId: M,
  warehouseId: WH,
  qty: '1.0000',
  sourceFingerprintSha256: H('f'),
  mappingCorrectionId: id(30),
  trueUpCoverage: 'not_covered',
  valuation: {
    schemaVersion: 1,
    kind: 'owner_attested_stock_currency',
    orgId: ORG,
    currency: 'PEN',
    attestedByProfileId: ACTOR,
    attestedAt: '2026-11-16T00:00:00.000Z',
    evidenceReference: 'ref',
    evidenceSha256: H('e'),
    keys: [
      {
        itemId: M,
        warehouseId: WH,
        latestLedgerId: '9007199254740993',
        latestLedgerRowSha256: H('1'),
      },
      { itemId: L, warehouseId: WH, latestLedgerId: null, latestLedgerRowSha256: null },
    ],
  },
  postedAt: '2026-11-17T12:00:00.000Z',
  reason: 'Faja M issued L',
  ownerApprovalReference: 'approval',
  ...over,
});
const facts = (over: Partial<GarmentFacts> = {}): GarmentFacts => ({
  ticket: { id: TICKET, status: 'submitted', stockEntryId: ENTRY },
  line: { id: LINE, ticketId: TICKET, finProductId: PROD, qty: '1' },
  entry: {
    id: ENTRY,
    type: 'issue',
    status: 'submitted',
    metadata: { source: 'pos', sourceId: TICKET },
  },
  entryLines: [{ itemId: L, qty: '1', warehouseId: WH }],
  currentMappedItemId: M,
  mappingReceiptValid: true,
  toBinQty: '19',
  fingerprintSha256: H('f'),
  ...over,
});

describe('garment manifest decoder', () => {
  it('is strict and binds the owner valuation to actor, org, time and the exact keys', () => {
    const m = decodeGarmentRepostManifestV1(raw());
    expect(m.valuation.keys[0].itemId).toBe(L); // canonical key order
    expect(garmentManifestSha256(m)).toBe(
      garmentManifestSha256(decodeGarmentRepostManifestV1(raw())),
    );
    expect(garmentManifestSha256(m)).not.toBe(
      garmentManifestSha256(
        decodeGarmentRepostManifestV1(raw({ postedAt: '2026-11-17T12:00:00.001Z' })),
      ),
    );
    for (const bad of [
      { extra: 1 },
      { qty: '1' },
      { qty: '0.0000' },
      { toItemId: L },
      { mappingCorrectionId: null },
      { postedAt: '2026-11-17T12:00:00Z' },
      { valuation: { ...raw().valuation, attestedByProfileId: id(99) } },
      { valuation: { ...raw().valuation, currency: 'pen' } },
      { valuation: { ...raw().valuation, attestedAt: '2026-11-18T00:00:00.000Z' } },
      { valuation: { ...raw().valuation, keys: raw().valuation.keys.slice(0, 1) } },
      { action: 'compensate' },
    ])
      expect(() => decodeGarmentRepostManifestV1(raw(bad))).toThrow();
    expect(
      decodeGarmentRepostManifestV1(
        raw({ action: 'compensate', inverseOfOperationId: id(21), mappingCorrectionId: null }),
      ).action,
    ).toBe('compensate');
  });
});

describe('planGarmentRepost', () => {
  const m = decodeGarmentRepostManifestV1(raw());
  it('admits the exact L to M move with signed qty effects', () => {
    expect(planGarmentRepost(m, facts())).toEqual({
      eligible: true,
      effects: [
        { itemId: L, warehouseId: WH, qtyDelta: '1.0000' },
        { itemId: M, warehouseId: WH, qtyDelta: '-1.0000' },
      ],
    });
  });
  it.each([
    ['stale fingerprint', { fingerprintSha256: H('0') }, 'stale_fingerprint'],
    ['void ticket', { ticket: { id: TICKET, status: 'void', stockEntryId: ENTRY } }, 'ticket_void'],
    [
      'ticket stamp elsewhere',
      { ticket: { id: TICKET, status: 'submitted', stockEntryId: id(77) } },
      'ticket_not_stamped',
    ],
    [
      'cancelled original',
      { entry: { id: ENTRY, type: 'issue', status: 'cancelled', metadata: {} } },
      'entry_not_submitted',
    ],
    [
      'booking-sourced issue',
      {
        entry: {
          id: ENTRY,
          type: 'issue',
          status: 'submitted',
          metadata: { source: 'booking', sourceId: TICKET },
        },
      },
      'source_not_pos',
    ],
    [
      'other ticket',
      {
        entry: {
          id: ENTRY,
          type: 'issue',
          status: 'submitted',
          metadata: { source: 'pos', sourceId: id(77) },
        },
      },
      'source_not_pos',
    ],
    [
      'unknown metadata',
      { entry: { id: ENTRY, type: 'issue', status: 'submitted', metadata: { source: 'made-up' } } },
      'source_not_pos',
    ],
    [
      'two stock lines',
      {
        entryLines: [
          { itemId: L, qty: '1', warehouseId: WH },
          { itemId: id(40), qty: '1', warehouseId: WH },
        ],
      },
      'not_single_line',
    ],
    [
      'wrong item',
      { entryLines: [{ itemId: id(40), qty: '1', warehouseId: WH }] },
      'not_single_line',
    ],
    [
      'quantity differs by one Q4 step',
      { entryLines: [{ itemId: L, qty: '1.0001', warehouseId: WH }] },
      'quantity_mismatch',
    ],
    [
      'sale quantity differs',
      { line: { id: LINE, ticketId: TICKET, finProductId: PROD, qty: '2' } },
      'quantity_mismatch',
    ],
    [
      'line is another product',
      { line: { id: LINE, ticketId: TICKET, finProductId: id(41), qty: '1' } },
      'not_physical_m_line',
    ],
    ['mapping not corrected', { currentMappedItemId: L }, 'mapping_not_corrected'],
    ['no mapping receipt', { mappingReceiptValid: false }, 'mapping_receipt_missing'],
    ['negative M stock', { toBinQty: '0.9999' }, 'negative_stock'],
    ['missing M bin', { toBinQty: null }, 'negative_stock'],
  ])('blocks: %s', (_n, over, code) =>
    expect(planGarmentRepost(m, facts(over as Partial<GarmentFacts>))).toEqual({
      eligible: false,
      code,
    }),
  );
  it('half-tie sub-Q4 differences below the step are equal, one full step is not', () => {
    expect(
      planGarmentRepost(m, facts({ entryLines: [{ itemId: L, qty: '1.00004', warehouseId: WH }] }))
        .eligible,
    ).toBe(true);
  });
  it('a compensation skips the mapping predicates but keeps source and quantity ones', () => {
    const c = decodeGarmentRepostManifestV1(
      raw({
        action: 'compensate',
        inverseOfOperationId: id(21),
        mappingCorrectionId: null,
        fromItemId: M,
        toItemId: L,
        valuation: { ...raw().valuation, keys: raw().valuation.keys },
      }),
    );
    expect(
      planGarmentRepost(
        c,
        facts({
          entryLines: [{ itemId: M, qty: '1', warehouseId: WH }],
          currentMappedItemId: null,
          mappingReceiptValid: false,
        }),
      ).eligible,
    ).toBe(true);
  });
});

describe('isInverseOf', () => {
  const fwd = decodeGarmentRepostManifestV1(raw());
  const inv = { ...fwd, fromItemId: fwd.toItemId, toItemId: fwd.fromItemId };
  it('accepts the exact swap and refuses any other item, qty, warehouse, line or missing manifest', () => {
    expect(isInverseOf(fwd, inv)).toBe(true);
    expect(isInverseOf(fwd, fwd)).toBe(false);
    expect(isInverseOf(fwd, { ...inv, toItemId: id(99) })).toBe(false);
    expect(isInverseOf(fwd, { ...inv, qty: '2.0000' })).toBe(false);
    expect(isInverseOf(fwd, { ...inv, warehouseId: id(98) })).toBe(false);
    expect(isInverseOf(fwd, { ...inv, ticketLineId: id(97) })).toBe(false);
    expect(isInverseOf(undefined, inv)).toBe(false);
  });
});
