import * as stockLogic from './stock.logic';
import {
  financialStateDigest,
  planCorrectEffects,
  ruleStateDigest,
  sourceStateDigest,
  type EntryEvidence,
  type ReceiptChainManifestV1,
} from './faces-receipt-correction.logic';

/** Shared synthetic fixture: opening 8 @ 250, receipt 89 @ 5474.58, a POS issue of 10 and a booking issue of 8. */
export const math = {
  computeLegValue: stockLogic.computeLegValue,
  applyLedgerDelta: stockLogic.applyLedgerDelta,
  round4: stockLogic.round4,
};
export const H = (n: number) => n.toString(16).padStart(64, '0');
export const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const SHA = 'a'.repeat(40);
export const TARGET = {
  databaseIdentity: H(1),
  authProject: 'proj',
  authUrl: 'https://auth.example.org',
};

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

export function manifest(over: Record<string, unknown> = {}): ReceiptChainManifestV1 {
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
  const consumers = [
    {
      kind: 'pos_ticket',
      id: U(301),
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
      intendedRealizedValue: newIssueCost(1),
    },
  ].sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : 1)) as never;
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
    consumers,
    entryMap,
    opening: { qty: '8', value: '2000', valuationRate: '250', ledgerId: '1899', rowSha256: H(60) },
    before: {
      binRowSha256: H(61),
      latestLedgerId: '1902',
      latestLedgerRowSha256: H(62),
      itemRowSha256: H(63),
      ruleStateSha256: ruleStateDigest(entries),
      sourceStateSha256: sourceStateDigest(entries, consumers),
      financialFiscalSha256: financialStateDigest(consumers),
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
export const json = (m: unknown) => JSON.parse(JSON.stringify(m));
