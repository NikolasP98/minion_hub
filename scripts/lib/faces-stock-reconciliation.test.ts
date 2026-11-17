import { describe, expect, it } from 'vitest';
import {
  assertReportConsistent,
  classifyCase,
  computeKeyTotals,
  decodeDiagnosticManifestV1,
  decodeReconciliationReport,
  decodeStockEntrySource,
  dedupeLedger,
  fixed4,
  parseDec,
  q4,
  runStableProjection,
  withinAggregateTolerance,
  withinScalarTolerance,
  type ClassifierComponent,
  type ClassifierInput,
  type LedgerMovement,
  type ReconciliationReport,
} from './faces-stock-reconciliation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  L = id(2),
  M = id(3),
  W = id(4),
  B1 = id(5),
  B2 = id(6),
  B3 = id(7),
  E1 = id(8),
  E2 = id(9);

describe('decodeStockEntrySource', () => {
  const sha = 'a'.repeat(64);
  it.each([
    ['issue', { source: 'pos', sourceId: T }, { kind: 'pos', id: T }],
    ['issue', { source: 'pos', sourceId: T, ticketId: T, quantity: 3 }, { kind: 'pos', id: T }],
    [
      'issue',
      { source: 'booking', sourceId: B1, finProductId: M, quantity: 1 },
      { kind: 'booking', id: B1 },
    ],
    ['issue', { source: 'invoice', invoiceId: T, providerRef: 'x' }, { kind: 'invoice', id: T }],
    // legacy uppercase/padded invoice ids match lower(btrim()) like the live unique index
    [
      'issue',
      { source: 'invoice', invoiceId: `  ${T.toUpperCase()} ` },
      { kind: 'invoice', id: T },
    ],
    [
      'issue',
      { source: 'service', sourceId: B1, finProductId: M },
      { kind: 'service', id: B1, finProductId: M },
    ],
    ['issue', { source: 'service' }, { kind: 'service', id: null, finProductId: null }],
    ['receipt', { purchaseId: T }, { kind: 'purchase', id: T }],
    [
      'adjustment',
      { source: 'repair-opening-balance', reconciliation: true },
      { kind: 'manual_reconciliation', label: 'repair-opening-balance' },
    ],
    [
      'adjustment',
      { source: 'analyst-reconciliation-2026-08', reconciliation: true },
      { kind: 'manual_reconciliation', label: 'analyst-reconciliation-2026-08' },
    ],
    // scripts/repair-stock-valuation.ts writes the opening balance as a RECEIPT without the flag
    [
      'receipt',
      { source: 'repair-opening-balance' },
      { kind: 'manual_reconciliation', label: 'repair-opening-balance' },
    ],
    ['issue', {}, { kind: 'none' }],
    ['receipt', { note: 'x' }, { kind: 'none' }],
  ])('%s %j', (type, meta, want) => {
    expect(decodeStockEntrySource(type, meta, sha)).toEqual(want);
  });
  it.each([
    ['issue', { source: 'pos', sourceId: T, ticketId: L }],
    ['issue', { source: 'pos', sourceId: 'nope' }],
    ['issue', { source: 'invoice' }],
    ['issue', { source: 'invoice', invoiceId: 'nope' }],
    ['receipt', { source: 'pos', sourceId: T }],
    ['receipt', { purchaseId: 'nope' }],
    ['adjustment', { source: 'repair-opening-balance' }],
    ['issue', { source: 'made-up' }],
    ['issue', { sourceId: T }],
    ['issue', null],
    ['issue', []],
  ])('%s %j is unknown with a hash and no raw metadata', (type, meta) => {
    const got = decodeStockEntrySource(type, meta, sha);
    expect(got).toEqual({ kind: 'unknown', metadataSha256: sha });
    expect(JSON.stringify(got)).not.toContain('made-up');
  });
});

describe('exact decimal policy', () => {
  it('rounds Q4 half ties like round4, including negatives', () => {
    expect(q4(parseDec('0.00005'))).toBe(1n);
    expect(q4(parseDec('-0.00005'))).toBe(0n);
    expect(q4(parseDec('-0.00015'))).toBe(-1n);
    expect(q4(parseDec('1.00004'))).toBe(10000n);
    expect(fixed4(-15000n)).toBe('-1.5000');
  });
  it('rejects nonfinite, exponent and ceiling', () => {
    for (const bad of ['NaN', 'Infinity', '1e3', '', '1,5', '1000000000.01'])
      expect(() => parseDec(bad)).toThrow();
    expect(() => parseDec('1000000000')).not.toThrow();
  });
  it('tolerance is inclusive and exact', () => {
    expect(withinScalarTolerance(parseDec('1'), parseDec('1.00000001')).pass).toBe(true);
    expect(withinScalarTolerance(parseDec('1'), parseDec('1.00000002')).pass).toBe(false);
    expect(withinScalarTolerance(parseDec('10.00000000'), parseDec('10.00000001')).pass).toBe(true);
    expect(withinScalarTolerance(parseDec('100'), parseDec('100.0000000000058')).pass).toBe(true); // observed ~5.8e-10
    const agg = withinAggregateTolerance(
      parseDec('0.00000001'),
      parseDec('0'),
      parseDec('999999999'),
    );
    expect(agg.pass).toBe(true);
  });
});

describe('manifest decoder', () => {
  const base = () => ({
    schemaVersion: 1,
    target: { databaseIdentity: 'b'.repeat(64), authProject: 'p', authUrl: 'https://p.example' },
    actorProfileId: id(90),
    cases: [
      {
        caseKey: 'c1',
        bookingIds: [B2, B1, B1],
        ticketIds: [],
        itemIds: [],
        identityUnresolved: false,
        searchHint: null,
        dateHints: null,
        evidenceRefs: [],
      },
    ],
  });
  it('sorts and dedupes ids, rejects unknown keys and bad hints', () => {
    expect(decodeDiagnosticManifestV1(base()).cases[0].bookingIds).toEqual([B1, B2]);
    expect(() => decodeDiagnosticManifestV1({ ...base(), extra: 1 })).toThrow();
    const noId = base();
    noId.cases[0].bookingIds = [];
    expect(() => decodeDiagnosticManifestV1(noId)).toThrow();
    noId.cases[0].identityUnresolved = true;
    (noId.cases[0] as { searchHint: unknown }).searchHint = { description: 'someone' };
    expect(decodeDiagnosticManifestV1(noId).cases[0].searchHint).toEqual({
      description: 'someone',
    });
    const dup = base();
    dup.cases.push({ ...dup.cases[0] });
    expect(() => decodeDiagnosticManifestV1(dup)).toThrow();
    const bad = base();
    (bad.cases[0] as { dateHints: unknown }).dateHints = {
      after: '2026-02-02',
      before: '2026-02-01',
      timezone: 'America/Lima',
    };
    expect(() => decodeDiagnosticManifestV1(bad)).toThrow();
  });
});

// --- classifier fixtures --------------------------------------------------------------------
let seq = 0;
const mv = (
  over: Partial<LedgerMovement> & { itemId: string; qtyDelta: string },
): LedgerMovement => {
  seq += 1;
  return {
    ledgerId: String(10_000_000_000_000_000_000n + BigInt(seq)),
    entryId: E1,
    entryState: 'submitted',
    entryType: 'issue',
    warehouseId: W,
    valueDelta: '0',
    qtyAfter: '0',
    valuationRate: '1',
    postedAt: '2026-11-01T00:00:00.000000Z',
    source: { kind: 'pos', id: T },
    ...over,
  };
};
const comp = (over: Partial<ClassifierComponent> = {}): ClassifierComponent => ({
  source: { kind: 'pos_ticket_line', id: id(30) },
  attribution: { kind: 'pos', id: T },
  itemId: M,
  warehouseId: W,
  intendedStockQty: '1.0000',
  stockUom: 'unit',
  fulfilled: true,
  trueUpCoverage: 'not_covered',
  intentSource: 'owner_assertion',
  evidenceReferenceIds: [],
  ...over,
});
const input = (over: Partial<ClassifierInput> = {}): ClassifierInput => ({
  identityState: 'matched',
  noStableIds: false,
  identityUnresolved: false,
  coverage: {
    sourceGraphComplete: true,
    ledgerHistoryComplete: true,
    openingKnown: true,
    fulfillmentKnown: true,
    trueUpCoverage: 'not_covered',
  },
  integrityFailed: false,
  numericUnsupported: false,
  evidenceConflict: false,
  components: [comp()],
  ledger: [],
  itemUoms: { [L]: 'unit', [M]: 'unit' },
  projections: [],
  mappingQualified: true,
  ...over,
});

describe('classifyCase', () => {
  it('valid when vectors match, with projection_unverified recorded', () => {
    const r = classifyCase(input({ ledger: [mv({ itemId: M, qtyDelta: '-1' })] }));
    expect(r.classification).toBe('valid');
    expect(r.reasonCodes).toEqual(['stock_matches_intent', 'projection_unverified']);
    expect(r.repairEligible).toBe(false);
  });
  it('variant mismatch: garment L issued for a Faja M, eligible only with every gate', () => {
    const base = input({ ledger: [mv({ itemId: L, qtyDelta: '-1' })] });
    const r = classifyCase(base);
    expect(r.classification).toBe('variant_mismatch');
    expect(r.repairEligible).toBe(true);
    expect(r.components[0].actualIssuedQty).toBe('0');
    const noMap = classifyCase({ ...base, mappingQualified: false });
    expect(noMap.classification).toBe('variant_mismatch');
    expect(noMap.repairEligible).toBe(false);
    expect(noMap.reasonCodes).toContain('mapping_not_qualified');
    const snap = classifyCase({
      ...base,
      components: [comp({ intentSource: 'historical_snapshot' })],
    });
    expect(snap.classification).toBe('unresolved'); // no documentary pairing, an unexpected key
    const uom = classifyCase({ ...base, itemUoms: { [L]: 'caja', [M]: 'unit' } });
    expect(uom.classification).toBe('unresolved');
    const covered = classifyCase({ ...base, components: [comp({ trueUpCoverage: 'covered' })] });
    expect(covered.classification).toBe('unresolved');
    expect(covered.reasonCodes).toContain('true_up_already_covered');
  });
  it('duplicate needs distinct live entries; a reversal explains the excess away', () => {
    const dup = classifyCase(
      input({
        ledger: [mv({ itemId: M, qtyDelta: '-1' }), mv({ itemId: M, qtyDelta: '-1', entryId: E2 })],
      }),
    );
    expect(dup.classification).toBe('duplicate');
    expect(dup.repairEligible).toBe(false);
    const reversed = classifyCase(
      input({
        ledger: [
          mv({ itemId: M, qtyDelta: '-1' }),
          mv({ itemId: M, qtyDelta: '-1', entryId: E2 }),
          mv({ itemId: M, qtyDelta: '1', entryId: E2, entryState: 'cancelled' }),
        ],
      }),
    );
    expect(reversed.classification).toBe('valid');
    const single = classifyCase(input({ ledger: [mv({ itemId: M, qtyDelta: '-2' })] }));
    expect(single.classification).toBe('unresolved');
    expect(single.reasonCodes).toContain('unsupported_shape');
  });
  it('missing realization and partial shortfall; a draft with no ledger is not an issue', () => {
    expect(classifyCase(input()).classification).toBe('missing_realization');
    const partial = classifyCase(
      input({
        components: [comp({ intendedStockQty: '2.0000' })],
        ledger: [mv({ itemId: M, qtyDelta: '-1' })],
      }),
    );
    expect(partial.classification).toBe('missing_realization');
    expect(partial.secondaryFindings[0]).toMatchObject({
      intendedQty: '2.0000',
      actualQty: '1.0000',
    });
  });
  it('mixed duplicate+variant is unresolved but retains both findings', () => {
    const c2 = comp({
      source: { kind: 'pos_ticket_line', id: id(31) },
      itemId: id(40),
      intendedStockQty: '1.0000',
    });
    const r = classifyCase(
      input({
        components: [comp(), c2],
        itemUoms: { [L]: 'unit', [M]: 'unit', [id(40)]: 'unit' },
        ledger: [
          mv({ itemId: L, qtyDelta: '-1' }),
          mv({ itemId: id(40), qtyDelta: '-1' }),
          mv({ itemId: id(40), qtyDelta: '-1', entryId: E2 }),
        ],
      }),
    );
    expect(r.classification).toBe('unresolved');
    expect(r.reasonCodes).toContain('mixed_discrepancies');
    expect(r.secondaryFindings.map((s) => s.kind).sort()).toEqual([
      'duplicate',
      'variant_mismatch',
    ]);
  });
  it('unknown source on an affected key, unknown intent, explicit zero and unknown true-up', () => {
    const unk = classifyCase(
      input({
        ledger: [
          mv({ itemId: M, qtyDelta: '-1' }),
          mv({
            itemId: M,
            qtyDelta: '-1',
            source: { kind: 'unknown', metadataSha256: 'c'.repeat(64) },
          }),
        ],
      }),
    );
    expect(unk.classification).toBe('unresolved');
    expect(unk.reasonCodes).toContain('stock_source_unknown');
    const unknownIntent = classifyCase(input({ components: [comp({ intendedStockQty: null })] }));
    expect(unknownIntent.reasonCodes).toContain('expected_effect_unknown');
    expect(unknownIntent.components[0].actualIssuedQty).toBeNull();
    const zero = classifyCase(input({ components: [comp({ intendedStockQty: '0.0000' })] }));
    expect(zero.classification).toBe('valid');
    expect(
      classifyCase(
        input({
          components: [comp({ trueUpCoverage: 'unknown' })],
          ledger: [mv({ itemId: M, qtyDelta: '-1' })],
        }),
      ).reasonCodes,
    ).toContain('true_up_coverage_unknown');
  });
  it('shared ticket across three bookings is compared once, in aggregate', () => {
    const comps = [B1, B2, B3].map((b, i) =>
      comp({
        source: { kind: 'booking', id: b },
        attribution: { kind: 'pos', id: T },
        intendedStockQty: '1.0000',
        evidenceReferenceIds: [id(60 + i)],
      }),
    );
    const ok = classifyCase(
      input({ components: comps, ledger: [mv({ itemId: M, qtyDelta: '-3' })] }),
    );
    expect(ok.classification).toBe('valid');
    const unalloc = classifyCase(
      input({
        components: comps.map((c) => ({ ...c, sharedUnallocated: true })),
        ledger: [mv({ itemId: M, qtyDelta: '-3' })],
      }),
    );
    expect(unalloc.reasonCodes).toContain('source_ownership_ambiguous');
  });
  it('display_only needs an admitted capture that disagrees; conflicts and changed sources block', () => {
    const ledger = [mv({ itemId: M, qtyDelta: '-1' })];
    const obs = (
      surface: 'booking_hover' | 'pos_ticket_detail',
      presence: 'shown' | 'omitted',
    ) => ({
      surface,
      source: { kind: 'pos_ticket' as const, id: T },
      productId: M,
      itemId: null,
      warehouseId: null,
      presence,
      qty: presence === 'shown' ? '1' : null,
      stockUom: presence === 'shown' ? 'unit' : null,
      observedAt: '2026-11-10T00:00:00.000Z',
      appSourceSha: null,
    });
    const key = `pos_ticket_line:${id(30)}:${M}:${W}`;
    const admitted = classifyCase(
      input({
        ledger,
        projections: [
          {
            referenceId: id(70),
            componentKey: key,
            state: 'admitted',
            observations: [obs('booking_hover', 'shown'), obs('pos_ticket_detail', 'omitted')],
            reason: 'matched_source_capture',
          },
        ],
      }),
    );
    expect(admitted.classification).toBe('display_only');
    const agree = classifyCase(
      input({
        ledger,
        projections: [
          {
            referenceId: id(70),
            componentKey: key,
            state: 'admitted',
            observations: [obs('booking_hover', 'shown'), obs('pos_ticket_detail', 'shown')],
            reason: 'matched_source_capture',
          },
        ],
      }),
    );
    expect(agree.classification).toBe('valid');
    const changed = classifyCase(
      input({
        ledger,
        projections: [
          {
            referenceId: id(70),
            componentKey: key,
            state: 'unavailable',
            observations: [],
            reason: 'projection_source_changed',
          },
        ],
      }),
    );
    expect(changed.reasonCodes).toContain('projection_source_changed');
    const wrong = classifyCase(
      input({
        ledger: [mv({ itemId: M, qtyDelta: '-2' }), mv({ itemId: M, qtyDelta: '-0', entryId: E2 })],
        projections: [
          {
            referenceId: id(70),
            componentKey: key,
            state: 'admitted',
            observations: [obs('booking_hover', 'shown'), obs('pos_ticket_detail', 'omitted')],
            reason: 'matched_source_capture',
          },
        ],
      }),
    );
    expect(wrong.classification).toBe('unresolved'); // an image never reclassifies a stock defect
  });
  it('identity, incompleteness and integrity are unresolved with fixed reasons', () => {
    expect(classifyCase(input({ noStableIds: true, components: [] })).reasonCodes).toContain(
      'no_stable_ids',
    );
    expect(classifyCase(input({ identityState: 'ambiguous' })).reasonCodes).toContain(
      'identity_ambiguous',
    );
    expect(
      classifyCase(
        input({
          coverage: {
            sourceGraphComplete: true,
            ledgerHistoryComplete: false,
            openingKnown: true,
            fulfillmentKnown: true,
            trueUpCoverage: 'not_covered',
          },
        }),
      ).reasonCodes,
    ).toContain('incomplete_read');
    expect(classifyCase(input({ integrityFailed: true })).reasonCodes).toContain(
      'integrity_failed',
    );
  });
});

describe('ledger identity and totals', () => {
  const big = '9007199254740993';
  const rows = [
    mv({
      itemId: M,
      qtyDelta: '5',
      qtyAfter: '5',
      entryType: 'receipt',
      ledgerId: '9007199254740993',
    }),
    mv({ itemId: M, qtyDelta: '-1', qtyAfter: '4', ledgerId: '9007199254740994' }),
  ];
  it('dedupes by id, orders as BigInt above MAX_SAFE_INTEGER, flags conflicting repeats', () => {
    const d = dedupeLedger([rows[1], rows[0], rows[0]]);
    expect(d.rows.map((r) => r.ledgerId)).toEqual(['9007199254740993', '9007199254740994']);
    expect(d.conflicts).toEqual([]);
    expect(dedupeLedger([rows[0], { ...rows[0], qtyDelta: '6' }]).conflicts).toEqual([big]);
    expect(() => dedupeLedger([{ ...rows[0], ledgerId: '01' }])).toThrow();
  });
  it('passes on a consistent bin, fails on missing bin, orphan bin and quantity drift', () => {
    expect(
      computeKeyTotals(rows, [{ itemId: M, warehouseId: W, qty: '4', rate: '1' }]).integrityFailed,
    ).toBe(false);
    expect(computeKeyTotals(rows, []).integrityFailed).toBe(true);
    expect(
      computeKeyTotals([], [{ itemId: M, warehouseId: W, qty: '2', rate: '1' }]).integrityFailed,
    ).toBe(true);
    const drift = computeKeyTotals(rows, [{ itemId: M, warehouseId: W, qty: '3.9999', rate: '1' }]);
    expect(drift.integrityFailed).toBe(true);
    expect(drift.totals[0]).toMatchObject({
      ledgerQtySum: '4',
      latestLedgerId: '9007199254740994',
      integrity: 'fail',
    });
    const noOpening = computeKeyTotals(
      [rows[1]],
      [{ itemId: M, warehouseId: W, qty: '4', rate: '1' }],
    );
    expect(noOpening.integrityFailed).toBe(true); // sum -1 vs terminal 4: opening history is missing
    const rate = computeKeyTotals(rows, [
      { itemId: M, warehouseId: W, qty: '4', rate: '1.00000001' },
    ]);
    expect(rate.integrityFailed).toBe(false);
    expect(
      computeKeyTotals(rows, [{ itemId: M, warehouseId: W, qty: '4', rate: '1.00000002' }])
        .integrityFailed,
    ).toBe(true);
  });
});

describe('report decoder and consistency', () => {
  const cov = {
    sourceGraphComplete: false,
    ledgerHistoryComplete: false,
    openingKnown: false,
    fulfillmentKnown: false,
    trueUpCoverage: 'unknown' as const,
  };
  const incomplete = (): ReconciliationReport => ({
    schemaVersion: 1,
    mode: 'read-only',
    orgId: id(80),
    actorProfileId: id(90),
    target: { databaseIdentity: 'b'.repeat(64), authProject: 'p', authUrl: 'https://p.example' },
    source: { gitSha: 'a'.repeat(40), deploymentVerified: false },
    observedAt: '2026-11-17T00:00:00.000000Z',
    snapshot: null,
    scope: { caseKeys: ['c1'], itemWarehouseKeys: [], dateHintsApplied: false },
    evidenceCoverage: cov,
    cases: [],
    ledger: [],
    graph: { nodes: [], edges: [] },
    sourceEvidence: [],
    timeline: [],
    sourceEvidenceSha256: null,
    projectionEvidence: [],
    labels: { items: [], products: [], warehouses: [] },
    totals: [],
    numericChecks: [],
    errors: [{ code: 'timeout', caseKey: null, ref: null }],
    outcome: 'incomplete',
    complete: false,
  });
  it('roundtrips a compact incomplete report and rejects each inconsistency', () => {
    const r = incomplete();
    expect(decodeReconciliationReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(() => assertReportConsistent({ ...r, errors: [] })).toThrow();
    expect(() => assertReportConsistent({ ...r, complete: true })).toThrow();
    expect(() => assertReportConsistent({ ...r, sourceEvidenceSha256: 'a'.repeat(64) })).toThrow();
    expect(() => decodeReconciliationReport({ ...r, extra: 1 })).toThrow();
    expect(() => decodeReconciliationReport({ ...r, orgId: 'x' })).toThrow();
  });
  it('run-stable projection ignores only run metadata', () => {
    const a = incomplete();
    const b = { ...incomplete(), observedAt: '2027-01-01T00:00:00.000000Z' };
    expect(runStableProjection(a)).toBe(runStableProjection(b));
    expect(runStableProjection(a)).not.toBe(
      runStableProjection({ ...b, scope: { ...b.scope, caseKeys: ['c2'] } }),
    );
  });
});
