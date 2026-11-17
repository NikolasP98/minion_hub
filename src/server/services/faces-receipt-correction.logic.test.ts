import { describe, expect, it } from 'vitest';
import { H, SHA, TARGET, U, json, manifest, math } from './faces-receipt-correction.test-fixture';
import {
  decodeReceiptChainManifestV1,
  decodeReceiptCorrectionCommand,
  decodeReceiptCorrectionStatusInput,
  planCorrectEffects,
  receiptManifestSha256,
  receiptPayloadHash,
  receiptPreviewHash,
  residualMatches,
} from './faces-receipt-correction.logic';

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
    swap((m) => (m.before.sourceStateSha256 = H(1)));
    swap((m) => (m.before.ruleStateSha256 = H(1)));
    swap((m) => (m.before.financialFiscalSha256 = H(1)));
    swap((m) => (m.basis.unitQualification.sources[1].lineRowSha256 = H(1)));
    swap((m) => (m.basis.unitQualification.itemRowSha256 = H(1)));
    swap((m) => (m.entries[1].uom = 'BOX'));
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
  it('refuses a wrong rounding residual and a POS consumer that is not the issue source ticket', () => {
    const wrong = json(manifest());
    wrong.basis.roundingResidual = '0.0032';
    expect(() => decodeReceiptChainManifestV1(wrong)).toThrow(/roundingResidual/);
    expect(
      residualMatches({ totalValuation: '5474.58', stockQty: '89', roundingResidual: '0.0031' }),
    ).toBe(true);
    const other = manifest();
    (other.consumers.find((c) => c.kind === 'pos_ticket') as { id: string }).id = U(999);
    expect(() => decodeReceiptChainManifestV1(json(other))).toThrow(/consumers/);
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
