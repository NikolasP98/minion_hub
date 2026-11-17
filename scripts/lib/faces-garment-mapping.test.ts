import { describe, expect, it } from 'vitest';
import {
  censusStateSha256,
  decodeMappingCommand,
  decodeMappingManifestV1,
  decodeMappingStatusInput,
  issuedStockQtyPerUnit,
  mappingManifestSha256,
  payloadHashOf,
  planMapping,
  previewHashOf,
  unchangedFactsDigest,
  type MappingFacts,
  type MappingManifestV1,
  type UnchangedFacts,
} from './faces-garment-mapping';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (c: string) => c.repeat(64);
const ORG = id(1),
  ACTOR = id(2),
  PROD_M = id(10),
  PROD_L = id(11),
  ITEM_L = id(20),
  ITEM_M = id(21);

const manifest = (over: Record<string, unknown> = {}): MappingManifestV1 =>
  decodeMappingManifestV1({
    schemaVersion: 1,
    kind: 'product_mapping',
    action: 'correct',
    target: { databaseIdentity: H('b'), authProject: 'p', authUrl: 'https://auth.example.org' },
    sourceCodeSha: 'a'.repeat(40),
    operationKey: id(3),
    orgId: ORG,
    actorProfileId: ACTOR,
    before: {
      productId: PROD_M,
      productRowSha256: H('1'),
      directBridgeItemId: null,
      recipe: [{ rowId: id(30), itemId: ITEM_L, qtyPerUnit: '1', note: null, rowSha256: H('2') }],
      ruleRows: [
        { table: 'stk_items', key: [ITEM_M], rowSha256: H('3') },
        { table: 'fin_products', key: [PROD_M], rowSha256: H('4') },
      ],
      preservedLProductId: PROD_L,
      preservedLMappingSha256: H('5'),
    },
    intended: {
      rowId: id(31),
      productId: PROD_M,
      itemId: ITEM_M,
      qtyPerUnit: '1.0000',
      stockUom: 'unit',
      note: null,
    },
    census: {
      complete: true,
      pendingDrafts: [],
      openAccruals: [],
      submittedIssues: [],
      ledgerHighWater: '9007199254740993',
      stateSha256: H('6'),
    },
    unchangedStockPaymentSha256: H('7'),
    rollout: {
      protocolVersion: 1,
      candidateSha: 'a'.repeat(40),
      evidenceReference: 'ref',
      evidenceSha256: H('8'),
    },
    reason: 'Faja M must issue M',
    ownerApprovalReference: 'owner-2026-11',
    ...over,
  });
const facts = (over: Partial<MappingFacts> = {}): MappingFacts => ({
  fromItem: { id: ITEM_L, uom: 'unit', consumptionUom: null, unitsPerStockUom: null },
  toItem: { id: ITEM_M, uom: 'unit', consumptionUom: null, unitsPerStockUom: null },
  componentRows: 0,
  toIsStockItem: true,
  deployedSha: 'a'.repeat(40),
  ...over,
});

describe('manifest decoder and hashes', () => {
  it('is strict, canonically ordered and hash-stable', () => {
    const m = manifest();
    expect(m.before.ruleRows.map((r) => r.table)).toEqual(['fin_products', 'stk_items']);
    expect(mappingManifestSha256(m)).toBe(mappingManifestSha256(manifest()));
    expect(() => decodeMappingManifestV1({ ...m, extra: 1 })).toThrow();
    expect(() => decodeMappingManifestV1({ ...m, inverseOfOperationId: id(9) })).toThrow(); // correct mode
    expect(() => decodeMappingManifestV1({ ...m, action: 'compensate' })).toThrow(); // missing inverse
    expect(() => manifest({ census: { ...m.census, complete: false } })).toThrow();
    expect(() => manifest({ rollout: { ...m.rollout, candidateSha: 'b'.repeat(40) } })).toThrow();
    expect(() => manifest({ intended: { ...m.intended, qtyPerUnit: '1' } })).toThrow(); // fixed4 only
    expect(() => manifest({ intended: { ...m.intended, productId: PROD_L } })).toThrow();
    expect(() => manifest({ census: { ...m.census, ledgerHighWater: '0123' } })).toThrow();
  });
  it('every hash-bound family changes the digest under the same key', () => {
    const base = mappingManifestSha256(manifest());
    const variants: Record<string, unknown>[] = [
      { reason: 'other' },
      { ownerApprovalReference: 'other' },
      { operationKey: id(99) },
      { intended: { ...manifest().intended, rowId: id(98) } },
      { rollout: { ...manifest().rollout, evidenceReference: 'x' } },
      { unchangedStockPaymentSha256: H('9') },
      { census: { ...manifest().census, ledgerHighWater: '9007199254740994' } },
    ];
    for (const v of variants) expect(mappingManifestSha256(manifest(v))).not.toBe(base);
  });
  it('command and status input bind the approved digest and key', () => {
    const m = manifest();
    const d = mappingManifestSha256(m);
    expect(
      decodeMappingCommand({ manifest: m, approvedPlanSha256: d, previewHash: H('a') }).previewHash,
    ).toBe(H('a'));
    expect(() =>
      decodeMappingCommand({ manifest: m, approvedPlanSha256: H('0'), previewHash: H('a') }),
    ).toThrow(/approved_plan/);
    const status = {
      target: m.target,
      orgId: ORG,
      actorProfileId: ACTOR,
      operationKey: m.operationKey,
      action: 'correct',
      manifestSha256: d,
      expectedPayloadHash: H('c'),
      manifest: m,
    };
    expect(decodeMappingStatusInput(status).manifest.operationKey).toBe(m.operationKey);
    expect(() => decodeMappingStatusInput({ ...status, action: 'compensate' })).toThrow(/conflict/);
    expect(() => decodeMappingStatusInput({ ...status, manifestSha256: H('d') })).toThrow(
      /conflict/,
    );
    const ph = previewHashOf({
      manifestSha256: d,
      beforeStateSha256: H('1'),
      censusStateSha256: H('2'),
      policyStateSha256: H('3'),
    });
    expect(
      payloadHashOf({ orgId: ORG, actorProfileId: ACTOR, manifestSha256: d, previewHash: ph }),
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(ph).not.toBe(
      previewHashOf({
        manifestSha256: d,
        beforeStateSha256: H('1'),
        censusStateSha256: H('9'),
        policyStateSha256: H('3'),
      }),
    );
  });
});

describe('unit semantics: one product unit must issue exactly one M stock unit', () => {
  const caja = { uom: 'caja', consumptionUom: 'ml', unitsPerStockUom: '500' };
  it('converts consumption quantity through units_per_stock_uom', () => {
    expect(
      issuedStockQtyPerUnit('1.0000', {
        uom: 'unit',
        consumptionUom: null,
        unitsPerStockUom: null,
      }),
    ).toBe(10_000n);
    expect(issuedStockQtyPerUnit('500.0000', caja)).toBe(10_000n);
    expect(issuedStockQtyPerUnit('5.0000', caja)).toBe(100n); // 0.01 caja
    expect(issuedStockQtyPerUnit('1.0000', { ...caja, unitsPerStockUom: '0' })).toBeNull();
    expect(issuedStockQtyPerUnit('1', { ...caja, unitsPerStockUom: '3' })).toBe(3333n);
  });
  it('a literal 1.0000 recipe on an item with a conversion does NOT issue one unit', () => {
    expect(
      planMapping(
        manifest(),
        facts({ toItem: { id: ITEM_M, uom: 'unit', consumptionUom: 'cm', unitsPerStockUom: '2' } }),
      ),
    ).toEqual({ eligible: false, code: 'unsupported_scope' });
    expect(
      planMapping(
        manifest({ intended: { ...manifest().intended, qtyPerUnit: '2.0000' } }),
        facts({ toItem: { id: ITEM_M, uom: 'unit', consumptionUom: 'cm', unitsPerStockUom: '2' } }),
      ),
    ).toEqual({ eligible: true });
  });
});

describe('planMapping', () => {
  it('admits the exact L to M replacement', () =>
    expect(planMapping(manifest(), facts())).toEqual({ eligible: true }));
  it.each([
    [
      'bridge present',
      { before: { ...manifest().before, directBridgeItemId: ITEM_L } },
      facts(),
      'unsupported_scope',
    ],
    [
      'two recipe rows',
      {
        before: {
          ...manifest().before,
          recipe: [
            ...manifest().before.recipe,
            { rowId: id(40), itemId: ITEM_M, qtyPerUnit: '1', note: null, rowSha256: H('2') },
          ],
        },
      },
      facts(),
      'unsupported_scope',
    ],
    [
      'recipe row reused',
      { intended: { ...manifest().intended, rowId: id(30) } },
      facts(),
      'unsupported_scope',
    ],
    [
      'already M',
      {
        before: {
          ...manifest().before,
          recipe: [{ ...manifest().before.recipe[0], itemId: ITEM_M }],
        },
      },
      facts({
        fromItem: { id: ITEM_M, uom: 'unit', consumptionUom: null, unitsPerStockUom: null },
      }),
      'unsupported_scope',
    ],
    [
      'stale item facts',
      {},
      facts({ toItem: { id: id(77), uom: 'unit', consumptionUom: null, unitsPerStockUom: null } }),
      'incomplete_evidence',
    ],
    [
      'uom drift',
      {},
      facts({ toItem: { id: ITEM_M, uom: 'caja', consumptionUom: null, unitsPerStockUom: null } }),
      'unsupported_scope',
    ],
    [
      'pending draft',
      {
        census: {
          ...manifest().census,
          pendingDrafts: [
            {
              sourceType: 'pos_ticket',
              sourceId: id(50),
              entryId: id(51),
              accrualId: null,
              state: 'draft',
              rowSha256: H('e'),
            },
          ],
        },
      },
      facts(),
      'cutover_pending_sources',
    ],
    [
      'open accrual',
      {
        census: {
          ...manifest().census,
          openAccruals: [
            {
              sourceType: 'booking',
              sourceId: id(52),
              entryId: null,
              accrualId: id(53),
              state: 'open',
              rowSha256: H('e'),
            },
          ],
        },
      },
      facts(),
      'cutover_pending_sources',
    ],
    ['target has components', {}, facts({ componentRows: 1 }), 'unsupported_scope'],
    ['target not a stock item', {}, facts({ toIsStockItem: false }), 'unsupported_scope'],
    ['no operator-attested deploy', {}, facts({ deployedSha: null }), 'rollout_unverified'],
    ['deploy sha differs', {}, facts({ deployedSha: 'c'.repeat(40) }), 'rollout_unverified'],
  ])('blocks %s', (_n, over, f, code) =>
    expect(planMapping(manifest(over as Record<string, unknown>), f)).toEqual({
      eligible: false,
      code,
    }),
  );
  it('submitted history is evidence, not a blocker', () => {
    const m = manifest({
      census: {
        ...manifest().census,
        submittedIssues: [
          {
            sourceType: 'pos_ticket',
            sourceId: id(50),
            entryId: id(51),
            accrualId: null,
            state: 'submitted',
            rowSha256: H('e'),
          },
        ],
      },
    });
    expect(planMapping(m, facts())).toEqual({ eligible: true });
  });
  it('census state hash ignores observation and order but sees every row', () => {
    const a = {
      sourceType: 'pos_ticket' as const,
      sourceId: id(1),
      entryId: null,
      accrualId: null,
      state: 'draft' as const,
      rowSha256: H('a'),
    };
    const b = { ...a, sourceId: id(2) };
    const base = {
      pendingDrafts: [a, b],
      openAccruals: [],
      submittedIssues: [],
      ledgerHighWater: '5',
    };
    expect(censusStateSha256(base)).toBe(censusStateSha256({ ...base, pendingDrafts: [b, a] }));
    expect(censusStateSha256(base)).not.toBe(censusStateSha256({ ...base, pendingDrafts: [a] }));
    expect(censusStateSha256(base)).not.toBe(censusStateSha256({ ...base, ledgerHighWater: '6' }));
  });
});

describe('unchanged stock/payment digest', () => {
  const f = (): UnchangedFacts => ({
    orgId: ORG,
    scope: {
      productIds: [PROD_L, PROD_M],
      itemIds: [ITEM_L, ITEM_M],
      binKeys: [[ITEM_L, id(60)]],
      entryIds: [id(70)],
      ticketIds: [id(80)],
      bookingIds: [],
      invoiceIds: [],
    },
    tables: [
      {
        table: 'stk_ledger',
        rows: [
          { key: ['9007199254740994'], rowSha256: H('2') },
          { key: ['9007199254740993'], rowSha256: H('1') },
        ],
      },
      { table: 'pos_payments', rows: [{ key: [id(90)], rowSha256: H('3') }] },
    ],
  });
  it('counts a row reached by two paths once, orders ledger keys as BigInt, and sees a changed payment', () => {
    const base = unchangedFactsDigest(f());
    const twice = f();
    twice.tables.push({ table: 'pos_payments', rows: [{ key: [id(90)], rowSha256: H('3') }] });
    expect(unchangedFactsDigest(twice)).toBe(base);
    const reordered = f();
    reordered.tables[0].rows.reverse();
    expect(unchangedFactsDigest(reordered)).toBe(base);
    const changed = f();
    changed.tables[1].rows[0].rowSha256 = H('4');
    expect(unchangedFactsDigest(changed)).not.toBe(base);
    const extra = f();
    extra.scope.binKeys.push([ITEM_M, id(60)]); // an inserted bin key changes the set (absence witness)
    expect(unchangedFactsDigest(extra)).not.toBe(base);
    const contradiction = f();
    contradiction.tables.push({
      table: 'pos_payments',
      rows: [{ key: [id(90)], rowSha256: H('5') }],
    });
    expect(() => unchangedFactsDigest(contradiction)).toThrow(/contradiction/);
    const bad = f();
    bad.tables[0].rows[0].key = ['0012'];
    expect(() => unchangedFactsDigest(bad)).toThrow();
  });
});
