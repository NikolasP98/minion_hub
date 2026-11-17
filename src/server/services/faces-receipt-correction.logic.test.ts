import { describe, expect, it } from 'vitest';
import * as stockLogic from './stock.logic';
import {
  decodeReceiptChainManifestV1,
  decodeReceiptCorrectionCommand,
  decodeReceiptCorrectionStatusInput,
  planCorrectEffects,
  receiptManifestSha256,
  receiptPayloadHash,
  receiptPreviewHash,
  type EntryEvidence,
  type ReceiptChainManifestV1,
} from './faces-receipt-correction.logic';

const math = {
  computeLegValue: stockLogic.computeLegValue,
  applyLedgerDelta: stockLogic.applyLedgerDelta,
  round4: stockLogic.round4,
};
const H = (n: number) => n.toString(16).padStart(64, '0');
const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SHA = 'a'.repeat(40);
const TARGET = { databaseIdentity: H(1), authProject: 'proj', authUrl: 'https://auth.example.org' };

/** Opening 8 @ 250 then receipt 89 @ 5474.58 then a POS issue of 10 and a booking issue of 8. */
function original(): EntryEvidence[] {
  let bin = { qty: 8, rate: 250 };
  const rows: EntryEvidence[] = [];
  const add = (
    i: number,
    type: 'receipt' | 'issue',
    qd: number,
    rate: number | null,
    source: EntryEvidence['source'],
  ) => {
    const leg = stockLogic.computeLegValue(bin, qd, rate);
    bin = stockLogic.applyLedgerDelta(bin, qd, leg.valueDelta);
    rows.push({
      entryId: U(100 + i),
      headerRowSha256: H(10 + i),
      lineId: U(200 + i),
      lineRowSha256: H(20 + i),
      type,
      ledgerId: String(1900 + i),
      ledgerRowSha256: H(30 + i),
      qty: String(Math.abs(qd)),
      uom: null,
      rate: rate === null ? null : String(rate),
      qtyDelta: String(qd),
      valueDelta: String(leg.valueDelta),
      qtyAfter: String(bin.qty),
      valuationRate: String(bin.rate),
      source,
    });
  };
  add(0, 'receipt', 89, 5474.58, { kind: 'receipt', id: U(100) });
  add(1, 'issue', -10, null, { kind: 'pos_ticket', id: U(301) });
  add(2, 'issue', -8, null, { kind: 'booking', id: U(302) });
  return rows;
}

function manifest(over: Record<string, unknown> = {}): ReceiptChainManifestV1 {
  const entries = original();
  const entryMap = entries.map((e, i) => ({
    sourceEntryId: e.entryId,
    replacementEntryId: U(500 + i),
  }));
  const intended = {
    receiptQty: '89',
    receiptRate: '61.5121',
    ...planCorrectEffects({ entries, entryMap, receiptRate: '61.5121' }, math),
  };
  const newIssueCost = (i: number) =>
    String(
      stockLogic.round4(-Number(intended.effects[intended.effects.length - 2 + i].valueDelta)),
    );
  const sources = entries.map((e) => ({
    entryId: e.entryId,
    lineId: e.lineId,
    headerRowSha256: e.headerRowSha256,
    lineRowSha256: e.lineRowSha256,
    sourceKind: e.source.kind,
    sourceId: e.source.id,
    writer:
      e.source.kind === 'receipt'
        ? 'receipt_stock_quantity'
        : e.source.kind === 'pos_ticket'
          ? 'pos_normalized_stock_quantity'
          : 'booking_normalized_stock_quantity',
    writerCodeSha: SHA,
    writerEvidenceSha256: H(40),
  }));
  return {
    schemaVersion: 1,
    kind: 'receipt_chain',
    target: TARGET,
    sourceCodeSha: SHA,
    orgId: U(1),
    actorProfileId: U(2),
    operationKey: U(3),
    sourceReceiptId: U(100),
    sourceReceiptLineId: U(200),
    itemId: U(4),
    warehouseId: U(5),
    stockUom: 'U',
    entries,
    consumers: [
      {
        kind: 'pos_ticket',
        id: U(401),
        rowSha256: H(50),
        currentEntryId: U(101),
        financialFiscalSha256: H(51),
        replacementEntryId: U(501),
      },
      {
        kind: 'stock_accrual',
        id: U(402),
        rowSha256: H(52),
        currentEntryId: U(102),
        sourceType: 'booking',
        sourceId: U(302),
        realizedQty: '8',
        realizedValue: '1',
        replacementEntryId: U(502),
        intendedRealizedValue: newIssueCost(0),
      },
    ].sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : 1)) as never,
    entryMap,
    opening: { qty: '8', value: '2000', valuationRate: '250', ledgerId: '1899', rowSha256: H(60) },
    before: {
      binRowSha256: H(61),
      latestLedgerId: '1902',
      latestLedgerRowSha256: H(62),
      itemRowSha256: H(63),
      ruleStateSha256: H(64),
      sourceStateSha256: H(65),
      financialFiscalSha256: H(66),
      policyStateSha256: H(67),
    },
    intended,
    postedAt: '2026-11-17T15:00:00.000Z',
    accountingTimezone: 'America/Lima',
    correctionMonth: '2026-11',
    reason: 'Invoice total correction',
    ownerApprovalReference: 'owner-ok',
    action: 'correct',
    basis: {
      policy: 'verified_document_total',
      reference: 'F-001',
      sha256: H(70),
      valuationCurrency: 'PEN',
      stockQty: '89',
      totalValuation: '5474.58',
      fxEvidenceSha256: H(71),
      taxFreightAllocationSha256: H(72),
      roundingResidual: '0.0031',
      residualAccepted: true,
      unitQualification: {
        schemaVersion: 1,
        receiptEntryId: U(100),
        receiptLineId: U(200),
        itemId: U(4),
        itemRowSha256: H(63),
        documentSha256: H(70),
        documentLineReference: 'l1',
        stockUom: 'U',
        documentUom: 'U',
        documentQuantity: '89',
        stockUnitsPerDocumentUnit: '1',
        historicalStockUomEvidenceSha256: H(73),
        conversionEvidenceSha256: H(74),
        verifiedByProfileId: U(2),
        verifiedAt: '2026-11-17T00:00:00.000Z',
        sources: sources as never,
      },
    },
    ...over,
  } as ReceiptChainManifestV1;
}
const json = (m: unknown) => JSON.parse(JSON.stringify(m));

describe('planCorrectEffects (the only author of effect strings)', () => {
  it('reverses issues descending then the receipt back to the opening, replays, and preserves terminal quantity', () => {
    const m = manifest();
    const f = m.intended.effects;
    expect(f.map((e) => e.phase)).toEqual([
      'reverse_issue',
      'reverse_issue',
      'reverse_receipt',
      'receipt',
      'issue',
      'issue',
    ]);
    // after reversing everything the bin is back at the opening 8 @ 250 (source-engine tolerance)
    expect(Number(f[2].qtyAfter)).toBeCloseTo(8, 9);
    expect(Number(f[2].valuationRate)).toBeCloseTo(250, 6);
    expect(Number(f[3].valueDelta)).toBeCloseTo(89 * 61.5121, 8);
    expect(m.intended.terminalQty).toBe('79');
    expect(Number(m.intended.terminalQty)).toBe(Number(m.entries[2].qtyAfter));
    // net COGS: new issue cost minus original issue cost; the lower receipt rate lowers COGS
    expect(Number(m.intended.netCogsDelta)).toBeLessThan(0);
  });
});

describe('decodeReceiptChainManifestV1', () => {
  it('accepts a valid correct manifest and hashes it stably', () => {
    const m = decodeReceiptChainManifestV1(json(manifest()));
    expect(receiptManifestSha256(m)).toBe(
      receiptManifestSha256(decodeReceiptChainManifestV1(json(manifest()))),
    );
    expect(receiptManifestSha256(m)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('every changed intent changes the digest (same key, changed intent conflicts)', () => {
    const base = receiptManifestSha256(manifest());
    for (const over of [
      { reason: 'other' },
      { ownerApprovalReference: 'other' },
      { postedAt: '2026-11-17T15:00:00.001Z' },
      { operationKey: U(9) },
      { warehouseId: U(9) },
    ])
      expect(receiptManifestSha256(manifest(over))).not.toBe(base);
  });
  it('rejects unknown/omitted keys, mixed action unions and wrong basis', () => {
    expect(() => decodeReceiptChainManifestV1({ ...json(manifest()), extra: 1 })).toThrow();
    const { reason: _r, ...omitted } = json(manifest());
    expect(() => decodeReceiptChainManifestV1(omitted)).toThrow();
    expect(() =>
      decodeReceiptChainManifestV1({ ...json(manifest()), inverseOfOperationId: U(8) }),
    ).toThrow();
    expect(() =>
      decodeReceiptChainManifestV1({ ...json(manifest()), action: 'compensate' }),
    ).toThrow();
    expect(() => decodeReceiptChainManifestV1({ ...json(manifest()), action: 'undo' })).toThrow();
    const m = json(manifest());
    m.basis.policy = 'restore_prior_before_snapshot';
    expect(() => decodeReceiptChainManifestV1(m)).toThrow();
  });
  it('rejects structural violations: map order, effect order, consumer ownership, rate/period', () => {
    const swap = (f: (m: ReturnType<typeof json>) => void) => {
      const m = json(manifest());
      f(m);
      expect(() => decodeReceiptChainManifestV1(m)).toThrow();
    };
    swap((m) => (m.entryMap[1].replacementEntryId = m.entries[0].entryId));
    swap((m) => (m.entryMap[1].replacementEntryId = m.entryMap[0].replacementEntryId));
    swap((m) => m.intended.effects.reverse());
    swap((m) => m.consumers.pop());
    swap((m) => (m.consumers[0].replacementEntryId = U(999)));
    swap((m) => (m.intended.receiptRate = '61.5122'));
    swap((m) => (m.correctionMonth = '2026-10'));
    swap((m) => (m.accountingTimezone = 'Not/AZone'));
    swap((m) => (m.entries[1].ledgerId = m.entries[0].ledgerId));
    swap((m) => (m.before.latestLedgerId = '1'));
    swap((m) => (m.entries[2].qty = '1234567890'));
    swap((m) => (m.basis.stockQty = '88'));
    swap((m) => (m.sourceCodeSha = 'zz'));
  });
  it('compensate carries the inverse reference and the restore policy only', () => {
    const base = manifest();
    const comp = {
      ...json(base),
      action: 'compensate',
      inverseOfOperationId: U(77),
      basis: {
        policy: 'restore_prior_before_snapshot',
        priorManifestSha256: H(80),
        originalDocumentSha256: H(81),
      },
    };
    expect(decodeReceiptChainManifestV1(comp).action).toBe('compensate');
    const { inverseOfOperationId: _i, ...noInverse } = comp;
    expect(() => decodeReceiptChainManifestV1(noInverse)).toThrow();
  });
  it('preserves raw null UOM through decode and hash', () => {
    expect(
      decodeReceiptChainManifestV1(json(manifest())).entries.every((e) => e.uom === null),
    ).toBe(true);
    const labelled = manifest();
    labelled.entries[0].uom = 'U';
    expect(receiptManifestSha256(labelled)).not.toBe(receiptManifestSha256(manifest()));
  });
});

describe('command and status decoders', () => {
  it('command approvedPlanSha256 must equal the manifest digest', () => {
    const m = manifest();
    const sha = receiptManifestSha256(m);
    expect(
      decodeReceiptCorrectionCommand({
        manifest: json(m),
        approvedPlanSha256: sha,
        previewHash: H(90),
      }).approvedPlanSha256,
    ).toBe(sha);
    expect(() =>
      decodeReceiptCorrectionCommand({
        manifest: json(m),
        approvedPlanSha256: H(1),
        previewHash: H(90),
      }),
    ).toThrow();
    expect(() =>
      decodeReceiptCorrectionCommand({
        manifest: json(m),
        approvedPlanSha256: sha,
        previewHash: H(90),
        extra: 1,
      }),
    ).toThrow();
  });
  it('status binds action/key/digest but its reader may differ from the historical actor', () => {
    const m = manifest();
    const input = {
      target: TARGET,
      orgId: m.orgId,
      actorProfileId: U(77),
      operationKey: m.operationKey,
      action: 'correct',
      manifestSha256: receiptManifestSha256(m),
      manifest: json(m),
    };
    expect(decodeReceiptCorrectionStatusInput(input).actorProfileId).toBe(U(77));
    expect(() => decodeReceiptCorrectionStatusInput({ ...input, action: 'compensate' })).toThrow();
    expect(() => decodeReceiptCorrectionStatusInput({ ...input, operationKey: U(9) })).toThrow();
    expect(() => decodeReceiptCorrectionStatusInput({ ...input, manifestSha256: H(5) })).toThrow();
  });
  it('preview and payload hashes bind their inputs', () => {
    const a = receiptPreviewHash({
      manifestSha256: H(1),
      sourceStateSha256: H(2),
      stockStateSha256: H(3),
      policyStateSha256: H(4),
    });
    expect(
      receiptPreviewHash({
        manifestSha256: H(1),
        sourceStateSha256: H(2),
        stockStateSha256: H(3),
        policyStateSha256: H(5),
      }),
    ).not.toBe(a);
    const p = receiptPayloadHash({
      orgId: U(1),
      actorProfileId: U(2),
      manifestSha256: H(1),
      previewHash: a,
    });
    expect(
      receiptPayloadHash({
        orgId: U(1),
        actorProfileId: U(3),
        manifestSha256: H(1),
        previewHash: a,
      }),
    ).not.toBe(p);
  });
});
