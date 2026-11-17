import { describe, expect, it } from 'vitest';
import {
  CORRECTION_STATUS,
  CorrectionError,
  RECEIPT_PERIOD_POLICY_ID,
  canonicalJson,
  changesValue,
  evaluateReceiptPeriod,
  monthInZone,
  normalizeDecimal,
  parsePreviewRequest,
  payloadHashOf,
  previewHashOf,
  transformFrozenIssueLines,
  validateReceiptReplacement,
} from './stock-corrections.logic';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as CorrectionError).code;
  }
  return null;
};
const variant = {
  mode: 'variant_swap',
  sourceType: 'pos_ticket_line',
  sourceId: U(1),
  expectedProductId: U(2),
  replacement: { productId: U(3) },
};
const receiptLine = (over = {}) => ({
  originalLineId: U(10),
  itemId: U(11),
  qty: '5',
  rate: '2.5',
  uom: 'unit',
  toWarehouseId: U(12),
  ...over,
});

describe('parsePreviewRequest', () => {
  it('accepts the two public shapes and rejects unknown keys / forbidden combinations', () => {
    expect(parsePreviewRequest(variant).mode).toBe('variant_swap');
    expect(code(() => parsePreviewRequest({ ...variant, lineId: U(9) }))).toBe('invalid_request');
    expect(code(() => parsePreviewRequest({ ...variant, sourceType: 'stock_receipt' }))).toBe(
      'invalid_request',
    );
    expect(code(() => parsePreviewRequest({ ...variant, sourceId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }))).toBe(
      'invalid_request',
    );
    expect(code(() => parsePreviewRequest({ mode: 'stock_only' }))).toBe('owner_evidence_required');
    expect(code(() => parsePreviewRequest({ mode: 'booking' }))).toBe('invalid_request');
  });
  it('normalizes receipt decimals and bounds them', () => {
    const r = parsePreviewRequest({
      mode: 'receipt_replace',
      sourceType: 'stock_receipt',
      sourceId: U(5),
      replacement: { lines: [receiptLine()] },
    });
    expect(r.mode === 'receipt_replace' && r.replacement.lines[0]).toMatchObject({
      qty: '5.0000',
      rate: '2.5000',
    });
    for (const qty of ['0', '-1', '1e3', '+1', '1.23456', '1234567890', ' 1', 'NaN'])
      expect(code(() => normalizeDecimal(qty, 'qty'))).toBe('invalid_request');
    const dup = {
      mode: 'receipt_replace',
      sourceType: 'stock_receipt',
      sourceId: U(5),
      replacement: { lines: [receiptLine(), receiptLine()] },
    };
    expect(code(() => parsePreviewRequest(dup))).toBe('invalid_request');
    const big = {
      ...dup,
      replacement: { lines: [receiptLine({ qty: '999999999', rate: '999999999' })] },
    };
    expect(code(() => parsePreviewRequest(big))).toBe('invalid_request');
    expect(code(() => parsePreviewRequest({ ...dup, replacement: { lines: [] } }))).toBe(
      'invalid_request',
    );
  });
});

describe('hashing', () => {
  it('is order independent for keys, binds intent, and excludes the operation key', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(() => canonicalJson({ a: -0 })).toThrow();
    const request = parsePreviewRequest(variant);
    const base = {
      orgId: 'o',
      actorProfileId: U(7),
      request,
      sourceSnapshot: { a: 1 },
      stockSnapshot: {},
      policySnapshot: {},
    };
    const p = previewHashOf(base);
    expect(p).toMatch(/^[0-9a-f]{64}$/);
    expect(previewHashOf({ ...base, sourceSnapshot: { a: 2 } })).not.toBe(p);
    const pay = payloadHashOf({
      orgId: 'o',
      actorProfileId: U(7),
      request,
      previewHash: p,
      reason: 'typo',
    });
    expect(
      payloadHashOf({ orgId: 'o', actorProfileId: U(7), request, previewHash: p, reason: 'other' }),
    ).not.toBe(pay);
    expect(
      payloadHashOf({ orgId: 'o', actorProfileId: U(8), request, previewHash: p, reason: 'typo' }),
    ).not.toBe(pay);
  });
});

describe('receipt period policy v1', () => {
  const at = new Date('2026-11-16T12:00:00Z');
  it('is eligible when both months are open and records the policy', () => {
    expect(
      evaluateReceiptPeriod({
        settingsTimezone: 'America/Lima',
        originalPostedAt: new Date('2026-10-02T12:00:00Z'),
        now: at,
        lockedPeriods: new Set(),
      }),
    ).toMatchObject({
      policyId: RECEIPT_PERIOD_POLICY_ID,
      originalMonth: '2026-10',
      currentMonth: '2026-11',
    });
  });
  it('refuses an absent settings row, and a locked original or current month', () => {
    const base = { originalPostedAt: new Date('2026-10-02T12:00:00Z'), now: at };
    expect(
      code(() =>
        evaluateReceiptPeriod({ ...base, settingsTimezone: null, lockedPeriods: new Set() }),
      ),
    ).toBe('policy_unverified');
    expect(
      code(() =>
        evaluateReceiptPeriod({
          ...base,
          settingsTimezone: 'America/Lima',
          lockedPeriods: new Set(['2026-10']),
        }),
      ),
    ).toBe('period_locked');
    expect(
      code(() =>
        evaluateReceiptPeriod({
          ...base,
          settingsTimezone: 'America/Lima',
          lockedPeriods: new Set(['2026-11']),
        }),
      ),
    ).toBe('period_locked');
  });
  it('evaluates months in the accounting timezone, not UTC', () => {
    const edge = new Date('2026-12-01T02:00:00Z'); // still Nov 30 in Lima
    expect(monthInZone(edge, 'America/Lima')).toBe('2026-11');
    expect(monthInZone(edge, 'UTC')).toBe('2026-12');
  });
});

describe('receipt replacement rules', () => {
  const orig = [
    { id: U(10), itemId: U(11), qty: '5', rate: '2.5', uom: 'unit', toWarehouseId: U(12) },
  ];
  const line = (over = {}) => receiptLine(over);
  it('derives a quantity or a rate delta, and flags value changes', () => {
    expect(validateReceiptReplacement(orig, [line({ qty: '6.0000' })])).toEqual([
      { lineId: U(10), kind: 'qty', before: '5', after: '6.0000' },
    ]);
    const d = validateReceiptReplacement(orig, [line({ rate: '3.0000' })]);
    expect(changesValue(d)).toBe(true);
    // unchanged rate = numeric equality with the stored rate
    expect(
      changesValue(validateReceiptReplacement(orig, [line({ qty: '6', rate: '2.5000' })])),
    ).toBe(false);
  });
  it('refuses item/warehouse/uom changes, both changes on one line, no change, and partial coverage', () => {
    for (const over of [
      { itemId: U(99) },
      { toWarehouseId: U(99) },
      { uom: 'box' },
      { qty: '6', rate: '3' },
      {},
      { originalLineId: U(98) },
    ])
      expect(code(() => validateReceiptReplacement(orig, [line(over)]))).toBe('invalid_request');
    expect(code(() => validateReceiptReplacement(orig, []))).toBe('invalid_request');
  });
});

describe('frozen sale lines', () => {
  const orig = [
    { itemId: 'M', qty: 1, fromWarehouseId: 'w' },
    { itemId: 'X', qty: 2, fromWarehouseId: 'w' },
  ];
  it('swaps one item pair and leaves every other line byte identical', () => {
    expect(transformFrozenIssueLines(orig, new Map([['M', 1]]), new Map([['L', 1]]), 'w')).toEqual([
      { itemId: 'X', qty: 2, fromWarehouseId: 'w' },
      { itemId: 'L', qty: 1, fromWarehouseId: 'w' },
    ]);
  });
  it('supports mixed swaps (nothing -> stock, stock -> nothing) and a shared item net', () => {
    expect(transformFrozenIssueLines(orig, new Map(), new Map([['L', 1]]), 'w2').at(-1)).toEqual({
      itemId: 'L',
      qty: 1,
      fromWarehouseId: 'w2',
    });
    expect(
      transformFrozenIssueLines(
        orig,
        new Map([
          ['M', 1],
          ['X', 2],
        ]),
        new Map(),
        'w',
      ),
    ).toEqual([]);
    expect(
      transformFrozenIssueLines(orig, new Map([['X', 1]]), new Map([['X', 1]]), 'w'),
    ).toContainEqual({ itemId: 'X', qty: 2, fromWarehouseId: 'w' });
  });
  it('refuses a removal larger than what the sale issued (recipe drift)', () => {
    expect(code(() => transformFrozenIssueLines(orig, new Map([['M', 3]]), new Map(), 'w'))).toBe(
      'stock_drift',
    );
  });
});

describe('refusal statuses', () => {
  it('keeps the existing 409s and closes the list', () => {
    expect(CORRECTION_STATUS.price_differs).toBe(409);
    expect(CORRECTION_STATUS.stock_drift).toBe(409);
    expect(CORRECTION_STATUS.negative_stock).toBe(409);
    expect(CORRECTION_STATUS.period_locked).toBe(422);
    expect(CORRECTION_STATUS.owner_evidence_required).toBe(422);
  });
});
