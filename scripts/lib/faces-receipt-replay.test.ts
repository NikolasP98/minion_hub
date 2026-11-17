import { describe, expect, it } from 'vitest';
import * as stockLogic from '../../src/server/services/stock.logic';
import {
  buildDiagnosticResult,
  decodeDiagnosticReport,
  decodeReceiptDiscovery,
  decodeValuationReplayPlan,
  diagnosticManifestSha256,
  diagnosticReportSha256,
  parseDiagnosticManifestJson,
  parseStrictJson,
  receiptRateBasis,
  type Consumer,
  type Coverage,
  type DiagnosticEvidenceManifestV1,
  type EntryHeader,
  type Movement,
  type SourceEvidence,
  type StockReplayMath,
} from './faces-receipt-replay';

const math: StockReplayMath = {
  computeLegValue: stockLogic.computeLegValue,
  applyLedgerDelta: stockLogic.applyLedgerDelta,
  round4: stockLogic.round4,
};
const H = (n: number) => n.toString(16).padStart(64, '0');
const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ORG = U(1);
const ITEM = U(2);
const WH = U(3);
const RECEIPT = U(100);
const RLINE = U(101);
const scalar = (v: string | null) =>
  v === null
    ? ({ state: 'missing', value: null } as const)
    : ({ state: 'value', value: v } as const);
const header = (id: string, type: string, n: number, status = 'submitted'): EntryHeader => ({
  id,
  humanId: null,
  type,
  status,
  postedAt: '2026-05-01T10:00:00.000Z',
  rowSha256: H(n),
  purchaseId: scalar(null),
  providerRef: scalar(null),
  currency: scalar(null),
  fxRate: scalar(null),
  fxUpdatedAt: scalar(null),
});
const SHA = 'a'.repeat(40);
const target = { databaseIdentity: H(7), authProject: 'proj', authUrl: 'https://auth.example.org' };

/** Opening 8 @ 250 then receipt 89 @ storedRate then `issues` of the given quantities (bin-consistent). */
function fixture(opts: { storedRate?: string; issues?: number[]; nullUom?: boolean } = {}) {
  const storedRate = opts.storedRate ?? '61.5121';
  const issueQty = opts.issues ?? [10, 8];
  let bin = { qty: 8, rate: 250 };
  const movs: Movement[] = [];
  const consumers: Consumer[] = [];
  const mk = (
    i: number,
    entryId: string,
    type: string,
    qd: number,
    rate: number | null,
    kind: Movement['source']['kind'],
    srcId: string | null,
  ) => {
    const leg = stockLogic.computeLegValue(bin, qd, rate);
    bin = stockLogic.applyLedgerDelta(bin, qd, leg.valueDelta);
    const line = {
      id: U(1000 + i),
      entryId,
      itemId: ITEM,
      qty: String(Math.abs(qd)),
      uom: opts.nullUom ? null : 'U',
      rate: rate === null ? null : String(rate),
      fromWarehouseId: null,
      toWarehouseId: WH,
      lineNo: 1,
      rowSha256: H(2000 + i),
    };
    movs.push({
      id: String(1900 + i),
      entryId,
      itemId: ITEM,
      warehouseId: WH,
      postedAt: '2026-05-01T10:00:00.000Z',
      qtyDelta: String(qd),
      valueDelta: String(leg.valueDelta),
      qtyAfter: String(bin.qty),
      valuationRate: String(bin.rate),
      rowSha256: H(3000 + i),
      header: header(entryId, type, 4000 + i),
      lines: [line],
      source: { kind, id: srcId },
      reversalOfLedgerId: null,
    });
  };
  mk(0, RECEIPT, 'receipt', 89, Number(storedRate), 'receipt', RECEIPT);
  issueQty.forEach((q, k) => {
    const id = U(200 + k);
    const booking = k % 2 === 1;
    mk(k + 1, id, 'issue', -q, null, booking ? 'booking' : 'pos_ticket', U(300 + k));
    consumers.push(
      booking
        ? {
            kind: 'stock_accrual',
            id: U(400 + k),
            rowSha256: H(5000 + k),
            entryId: id,
            sourceType: 'booking',
            sourceId: U(300 + k),
            itemId: ITEM,
            realizedQty: String(q),
            realizedValue: String(stockLogic.round4(-Number(movs[k + 1].valueDelta))),
            realizedAt: '2026-05-02T00:00:00.000Z',
            status: 'realized',
          }
        : {
            kind: 'pos_ticket',
            id: U(400 + k),
            rowSha256: H(5000 + k),
            entryId: id,
            financialFiscalSha256: H(6000 + k),
          },
    );
  });
  movs[0].lines[0].rate = storedRate;
  const last = movs[movs.length - 1];
  const source: SourceEvidence = {
    receipt: movs[0].header,
    line: movs[0].lines[0],
    item: {
      id: ITEM,
      rowSha256: H(9),
      stockUom: 'U',
      consumptionUom: null,
      unitsPerStockUom: null,
    },
    warehouse: { id: WH, rowSha256: H(10) },
    bin: { rowSha256: H(11), qty: last.qtyAfter, rate: last.valuationRate },
    opening: {
      state: 'verified',
      priorLedgerId: '1899',
      priorRowSha256: H(12),
      qty: '8',
      rate: '250',
      valueEngine: '2000',
    },
    context: [],
    affected: movs,
    boundary: null,
    consumers,
  };
  const coverage: Coverage = {
    readsComplete: true,
    contextComplete: true,
    affectedComplete: true,
    consumersComplete: true,
    baselineComplete: false,
    hypotheticalComplete: false,
    contextCount: 0,
    affectedCount: movs.length,
    consumerCount: consumers.length,
    contextReadCount: 0,
    affectedReadCount: movs.length,
    consumerReadCount: consumers.length,
    lastReadLedgerId: last.id,
    latestSameKeyLedgerId: last.id,
    maxObservedLedgerId: last.id,
  };
  return { source, coverage };
}
const manifest = (
  over: Partial<DiagnosticEvidenceManifestV1> = {},
): DiagnosticEvidenceManifestV1 => ({
  schemaVersion: 1,
  kind: 'receipt_diagnostic',
  target,
  sourceCodeSha: SHA,
  orgId: ORG,
  actorProfileId: U(5),
  receiptEntryId: RECEIPT,
  receiptLineId: RLINE,
  approvalReference: 'owner-ref',
  document: { state: 'absent' },
  unitQualification: null,
  hypothesis: null,
  residualAccepted: false,
  ...over,
});
const HYP = { stockQty: '89', stockUom: 'U', valuationCurrency: 'PEN', totalValuation: '5474.58' };

describe('receipt rate boundary (89 units / 5474.58)', () => {
  it('rounds to four decimals half away from zero with explicit residual', () => {
    const r = receiptRateBasis('5474.58', '89');
    expect(r.receiptRate).toBe('61.5121');
    expect(r.receiptContribution).toEqual({ numerator: '54745769', denominator: '10000' });
    expect(r.rateRoundingResidual).toEqual({ numerator: '31', denominator: '10000' });
    expect(r.centDisplayTotal).toBe('5474.58');
  });
});

describe('buildDiagnosticResult', () => {
  it('absent document and no hypothesis: complete discovery, null basis, never a fake rate', () => {
    const { source, coverage } = fixture();
    const r = buildDiagnosticResult(manifest(), source, coverage, 'hypothetical_replay', math);
    expect(r.mode).toBe('discovery');
    expect(r.outcome).toBe('complete');
    expect(r.basisChoice).toBeNull();
    expect(r.blockers).toEqual(expect.arrayContaining(['cost_basis_missing', 'document_absent']));
    expect(r.eligible).toBe(false);
    expect(() => decodeReceiptDiscovery(JSON.parse(JSON.stringify(r)))).not.toThrow();
  });

  it('explicit hypothesis replays: opening 8@250 + 89@61.5121 then issues, quantities preserved', () => {
    const { source, coverage } = fixture({ storedRate: '5474.58', issues: [10, 8] });
    const r = buildDiagnosticResult(
      manifest({ hypothesis: HYP }),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    if (r.mode !== 'hypothetical_replay' || r.outcome !== 'complete')
      throw new Error(`got ${r.mode}/${r.outcome} ${JSON.stringify(r.errors)}`);
    expect(r.readiness).toBe('unverified');
    expect(r.basisChoice.receiptRate).toBe('61.5121');
    expect(r.basisChoice.comparison).toBe('assumed_currency_numeric_only');
    // independent expected values: receipt contribution 5474.5769, then 97 units / 7474.5769
    expect(Number(r.rows[0].intended.valueDelta)).toBeCloseTo(5474.5769, 8);
    expect(Number(r.rows[0].intended.qtyAfter)).toBe(97);
    expect(Number(r.rows[0].intended.valuationRate)).toBeCloseTo(7474.5769 / 97, 8);
    expect(r.rows.every((x) => Object.values(x.oracle).every((o) => o.passed))).toBe(true);
    expect(r.totals.quantityDifference).toBe('0');
    expect(Number(r.totals.intendedTerminalQty)).toBe(79);
    // intended remaining = 79 units at the moving average of 7474.5769/97
    expect(Number(r.totals.intendedRemainingValue)).toBeCloseTo((7474.5769 / 97) * 79, 7);
    // receipt delta partitioned between COGS and remaining value (conservation)
    expect(Math.abs(Number(r.totals.conservationDifference))).toBeLessThan(1e-7);
    expect(r.consumerEffects).toHaveLength(2);
    expect(r.consumerEffects.map((c) => c.kind).sort()).toEqual(['pos_ticket', 'stock_accrual']);
    expect(r.coverage.hypotheticalComplete).toBe(true);
    expect(() => decodeValuationReplayPlan(JSON.parse(JSON.stringify(r)))).not.toThrow();
  });

  it('hypothesis quantity disagreeing with the frozen receipt gives no basis', () => {
    const { source, coverage } = fixture();
    const r = buildDiagnosticResult(
      manifest({ hypothesis: { ...HYP, stockQty: '90' } }),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    expect(r.mode).toBe('discovery');
    expect(r.basisChoice).toBeNull();
    expect(r.blockers).toContain('quantity_mismatch');
  });

  it('baseline mismatch is integrity with no hypothetical prefix', () => {
    const { source, coverage } = fixture();
    source.affected[1].qtyAfter = '1';
    const r = buildDiagnosticResult(
      manifest({ hypothesis: HYP }),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    expect(r.outcome).toBe('integrity');
    expect(r.complete).toBe(false);
    if (r.mode === 'hypothetical_replay') expect(r.rows).toEqual([]);
  });

  it.each([
    ['transfer', 'unsupported_transfer'],
    ['adjustment', 'unsupported_adjustment'],
    ['receipt', 'unsupported_second_receipt'],
  ])('%s after the receipt is original-only unsupported', (type, code) => {
    const { source, coverage } = fixture();
    source.affected[1].header.type = type;
    const r = buildDiagnosticResult(
      manifest({ hypothesis: HYP }),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    expect(r.outcome).toBe('unsupported');
    expect(r.blockers).toContain(code);
    expect(r.coverage.hypotheticalComplete).toBe(false);
  });

  it('reversal (cancelled entry), unknown source, multiline and zero terminal are unsupported', () => {
    for (const [mutate, code] of [
      [(s: SourceEvidence) => (s.affected[1].header.status = 'cancelled'), 'unsupported_reversal'],
      [
        (s: SourceEvidence) => (s.affected[1].source = { kind: 'unknown', id: null }),
        'unsupported_source',
      ],
      [
        (s: SourceEvidence) => s.affected[1].lines.push({ ...s.affected[1].lines[0], id: U(9999) }),
        'unsupported_multiline',
      ],
      [(s: SourceEvidence) => (s.affected[2].qtyAfter = '0'), 'unsupported_zero_quantity'],
    ] as const) {
      const { source, coverage } = fixture();
      mutate(source);
      const r = buildDiagnosticResult(
        manifest({ hypothesis: HYP }),
        source,
        coverage,
        'hypothetical_replay',
        math,
      );
      expect(r.outcome).toBe('unsupported');
      expect(r.blockers).toContain(code);
    }
  });

  it('the 129th issue is an unsupported_issue_cap boundary, never admitted', () => {
    const { source, coverage } = fixture({ issues: Array.from({ length: 128 }, () => 0.5) });
    source.boundary = { ...source.affected[1], id: '9999' };
    coverage.affectedComplete = false;
    coverage.affectedCount = null;
    const r = buildDiagnosticResult(
      manifest({ hypothesis: HYP }),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    expect(r.outcome).toBe('unsupported');
    expect(r.errors.find((e) => e.code === 'unsupported_issue_cap')?.limit).toBe(128);
  });

  it('incomplete reads never fake a complete prefix; unknown opening is not zero', () => {
    const a = fixture();
    a.coverage.contextComplete = false;
    expect(buildDiagnosticResult(manifest(), a.source, a.coverage, 'discovery', math).outcome).toBe(
      'incomplete',
    );
    const b = fixture();
    b.source.opening = {
      state: 'unknown',
      priorLedgerId: null,
      priorRowSha256: null,
      qty: null,
      rate: null,
      valueEngine: null,
    };
    const r = buildDiagnosticResult(manifest(), b.source, b.coverage, 'discovery', math);
    expect(r.outcome).toBe('incomplete');
  });

  it('unknown consumer cost (null) blocks rather than becoming 0', () => {
    const { source, coverage } = fixture({ issues: [10, 8] });
    (source.consumers[1] as Extract<Consumer, { kind: 'stock_accrual' }>).realizedValue = null;
    const r = buildDiagnosticResult(
      manifest({ hypothesis: HYP }),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    expect(r.outcome).toBe('unsupported');
    expect(r.blockers).toContain('consumer_unresolved');
  });

  it('raw null UOM survives replay and serialization unchanged', () => {
    const { source, coverage } = fixture({ nullUom: true });
    const r = buildDiagnosticResult(
      manifest({ hypothesis: HYP }),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    expect(r.source.affected[0].lines[0].uom).toBeNull();
    expect(
      decodeDiagnosticReport({
        metadata: {
          runId: U(8),
          observedAt: '2026-11-17T00:00:00.000Z',
          snapshotId: 's',
          outputReference: null,
        },
        diagnosticManifestSha256: r.diagnosticManifestSha256,
        reportSha256: diagnosticReportSha256(r.diagnosticManifestSha256, r),
        result: JSON.parse(JSON.stringify(r)),
      }).result.source.affected[0].lines[0].uom,
    ).toBeNull();
  });
});

describe('digests', () => {
  it('are stable across run/path metadata and diverge on changed source or null-to-label UOM', () => {
    const a = fixture({ nullUom: true });
    const m = manifest({ hypothesis: HYP });
    const ra = buildDiagnosticResult(m, a.source, a.coverage, 'hypothetical_replay', math);
    const rb = buildDiagnosticResult(m, a.source, a.coverage, 'hypothetical_replay', math);
    expect(diagnosticReportSha256(diagnosticManifestSha256(m), ra)).toBe(
      diagnosticReportSha256(diagnosticManifestSha256(m), rb),
    );
    const labelled = fixture({ nullUom: false });
    const rl = buildDiagnosticResult(
      m,
      labelled.source,
      labelled.coverage,
      'hypothetical_replay',
      math,
    );
    expect(diagnosticReportSha256(diagnosticManifestSha256(m), rl)).not.toBe(
      diagnosticReportSha256(diagnosticManifestSha256(m), ra),
    );
    expect(
      diagnosticManifestSha256(manifest({ hypothesis: { ...HYP, totalValuation: '5474.59' } })),
    ).not.toBe(diagnosticManifestSha256(m));
  });
});

describe('strict manifest decoding', () => {
  const text = (o: unknown) => JSON.stringify(o);
  it('accepts the minimal valid manifest', () => {
    expect(parseDiagnosticManifestJson(text(manifest({ hypothesis: HYP })))).toEqual(
      manifest({ hypothesis: HYP }),
    );
  });
  it('rejects duplicate keys, unknown keys, omitted fields, bad unions and excess depth', () => {
    const ok = text(manifest());
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow();
    expect(() =>
      parseDiagnosticManifestJson(ok.replace('"kind"', '"kind":"receipt_diagnostic","kind"')),
    ).toThrow();
    expect(() => parseDiagnosticManifestJson(text({ ...manifest(), extra: 1 }))).toThrow();
    const { hypothesis: _h, ...omitted } = manifest();
    expect(() => parseDiagnosticManifestJson(text(omitted))).toThrow();
    expect(() =>
      parseDiagnosticManifestJson(text(manifest({ document: { state: 'bogus' } as never }))),
    ).toThrow();
    expect(() => parseDiagnosticManifestJson(text(manifest({ sourceCodeSha: 'zz' })))).toThrow();
    expect(() =>
      parseDiagnosticManifestJson(
        text(manifest({ hypothesis: { ...HYP, totalValuation: '1e3' } })),
      ),
    ).toThrow();
    expect(() => parseStrictJson('['.repeat(70) + ']'.repeat(70))).toThrow();
    expect(() => parseStrictJson(`"${'x'.repeat(1048577)}"`)).toThrow();
  });
  it('rejects an unverified document whose reference/sha disagrees with its facts', () => {
    const facts = {
      reference: 'inv-1',
      documentLineReference: 'l1',
      sha256: H(1),
      purchaseId: null,
      providerRef: null,
      quantity: '89',
      uom: 'box',
      allocation: {
        policy: 'single_line',
        net: '1',
        tax: '0',
        freight: '0',
        discount: '0',
        inventoryCost: '1',
        evidenceSha256: H(2),
      },
      fx: {
        sourceCurrency: 'PEN',
        valuationCurrency: 'PEN',
        rate: '1',
        effectiveAt: '2026-05-01T00:00:00.000Z',
        sourceInventoryCost: '1',
        totalValuation: '1',
        conversionResidual: '0',
        historicalValuationCurrencyEvidenceSha256: H(3),
        evidenceSha256: H(4),
      },
    };
    const good = manifest({
      document: { state: 'unverified', reference: 'inv-1', sha256: H(1), facts } as never,
    });
    expect(() => parseDiagnosticManifestJson(text(good))).not.toThrow();
    const wrong = manifest({
      document: { state: 'unverified', reference: 'inv-2', sha256: H(1), facts } as never,
    });
    expect(() => parseDiagnosticManifestJson(text(wrong))).toThrow();
  });
});

describe('owner-attested document and unit qualification', () => {
  function attested(
    source: SourceEvidence,
    over: { quantity?: string; total?: string; tax?: string } = {},
  ) {
    const unitQualification = {
      schemaVersion: 1 as const,
      receiptEntryId: RECEIPT,
      receiptLineId: RLINE,
      itemId: ITEM,
      itemRowSha256: H(9),
      documentSha256: H(21),
      documentLineReference: 'l1',
      stockUom: 'U',
      documentUom: 'U',
      documentQuantity: over.quantity ?? '89',
      stockUnitsPerDocumentUnit: '1',
      historicalStockUomEvidenceSha256: H(22),
      conversionEvidenceSha256: H(23),
      verifiedByProfileId: U(5),
      verifiedAt: '2026-11-17T00:00:00.000Z',
      sources: source.affected.map((mv) => ({
        entryId: mv.entryId,
        lineId: mv.lines[0].id,
        headerRowSha256: mv.header.rowSha256,
        lineRowSha256: mv.lines[0].rowSha256,
        sourceKind: mv.source.kind as 'receipt' | 'pos_ticket' | 'booking',
        sourceId: mv.source.id as string,
        writer: (mv.source.kind === 'receipt'
          ? 'receipt_stock_quantity'
          : mv.source.kind === 'pos_ticket'
            ? 'pos_normalized_stock_quantity'
            : 'booking_normalized_stock_quantity') as 'receipt_stock_quantity',
        writerCodeSha: SHA,
        writerEvidenceSha256: H(24),
      })),
    };
    const total = over.total ?? '5474.58';
    const facts = {
      reference: 'F-001',
      documentLineReference: 'l1',
      sha256: H(21),
      purchaseId: null,
      providerRef: null,
      quantity: over.quantity ?? '89',
      uom: 'U',
      allocation: {
        policy: 'single_line' as const,
        net: '5000',
        tax: over.tax ?? '474.58',
        freight: '0',
        discount: '0',
        inventoryCost: '5474.58',
        evidenceSha256: H(25),
      },
      fx: {
        sourceCurrency: 'PEN',
        valuationCurrency: 'PEN',
        rate: '1',
        effectiveAt: '2026-05-01T00:00:00.000Z',
        sourceInventoryCost: '5474.58',
        totalValuation: total,
        conversionResidual: '0',
        historicalValuationCurrencyEvidenceSha256: H(26),
        evidenceSha256: H(27),
      },
    };
    return manifest({
      document: {
        state: 'owner_attested',
        facts,
        verifiedByProfileId: U(5),
        verifiedAt: '2026-11-17T00:00:00.000Z',
        approvalReference: 'ok',
      },
      unitQualification,
      residualAccepted: true,
    });
  }
  const text = (m: DiagnosticEvidenceManifestV1) => parseDiagnosticManifestJson(JSON.stringify(m));

  it('matching evidence gives verifiedBasis and document_qualified but never eligible', () => {
    const { source, coverage } = fixture({ storedRate: '5474.58', nullUom: true });
    const r = buildDiagnosticResult(
      text(attested(source)),
      source,
      coverage,
      'hypothetical_replay',
      math,
    );
    expect(r.readiness).toBe('document_qualified');
    expect(r.document.state).toBe('verified');
    expect(r.document.verifiedBasis?.roundingResidual).toBe('0.0031');
    expect(r.eligible).toBe(false);
    expect(r.mode === 'hypothetical_replay' && r.basisChoice?.comparison).toBe('verified_currency');
  });
  it('wrong quantity, allocation or unit source gives mismatched with no verified basis', () => {
    const a = fixture({ storedRate: '5474.58' });
    const wrongQty = buildDiagnosticResult(
      text(attested(a.source, { quantity: '88' })),
      a.source,
      a.coverage,
      'discovery',
      math,
    );
    expect(wrongQty.document.state).not.toBe('verified');
    expect(wrongQty.document.verifiedBasis).toBeNull();
    const wrongAlloc = buildDiagnosticResult(
      text(attested(a.source, { tax: '1' })),
      a.source,
      a.coverage,
      'discovery',
      math,
    );
    expect(wrongAlloc.document.state).toBe('mismatched');
    const m = attested(a.source);
    m.unitQualification!.sources[1].lineRowSha256 = H(99);
    const wrongUnit = buildDiagnosticResult(text(m), a.source, a.coverage, 'discovery', math);
    expect(wrongUnit.document.unitState).toBe('mismatched');
    expect(wrongUnit.document.verifiedBasis).toBeNull();
  });
  it('a stored label that contradicts the qualified stock unit blocks', () => {
    const a = fixture({ storedRate: '5474.58' });
    a.source.affected[1].lines[0].uom = 'BOX';
    const r = buildDiagnosticResult(
      text(attested(a.source)),
      a.source,
      a.coverage,
      'discovery',
      math,
    );
    expect(r.document.unitState).toBe('mismatched');
  });
  it('without residual acceptance there is no verified basis', () => {
    const a = fixture({ storedRate: '5474.58' });
    const m = attested(a.source);
    m.residualAccepted = false;
    const r = buildDiagnosticResult(text(m), a.source, a.coverage, 'discovery', math);
    expect(r.document.verifiedBasis).toBeNull();
    expect(r.blockers).toContain('residual_unaccepted');
  });
});
