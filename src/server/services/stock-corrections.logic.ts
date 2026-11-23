/**
 * Pure rules for the stock correction workflow (spec 124): closed request/refusal vocabulary,
 * strict request parsing, canonical hashing, the receipt period policy and the frozen-line
 * transform. No database, no clock reads (callers pass `now`), so every branch is unit-testable.
 */
import { instantMonthKey } from '$lib/time/zoned';
import { createHash } from 'node:crypto';

export const RECEIPT_PERIOD_POLICY_ID = 'receipt_period_v1';

/** Closed refusal list (orchestrator decision 8). HTTP statuses: see CORRECTION_STATUS. */
export type CorrectionRefusalCode =
  | 'invalid_request'
  | 'forbidden'
  | 'cost_visibility_required'
  | 'owner_required'
  | 'not_found'
  | 'stale_preview'
  | 'operation_conflict'
  | 'key_reuse'
  | 'price_differs'
  | 'stock_drift'
  | 'negative_stock'
  | 'source_ambiguous'
  | 'dependent_history'
  | 'policy_unverified'
  | 'period_locked'
  | 'record_locked'
  | 'stock_scope_required'
  | 'owner_evidence_required'
  | 'duplicate_source'
  | 'module_disabled'
  | 'repost_pending'
  | 'unavailable';

/** price_differs / stock_drift / negative_stock keep their existing 409 (they are 409 in the POS and stock error maps today). */
export const CORRECTION_STATUS: Record<CorrectionRefusalCode, number> = {
  invalid_request: 400,
  forbidden: 403,
  cost_visibility_required: 403,
  owner_required: 403,
  not_found: 404,
  stale_preview: 409,
  operation_conflict: 409,
  key_reuse: 409,
  price_differs: 409,
  stock_drift: 409,
  negative_stock: 409,
  source_ambiguous: 422,
  dependent_history: 422,
  policy_unverified: 422,
  period_locked: 422,
  record_locked: 422,
  stock_scope_required: 422,
  owner_evidence_required: 422,
  duplicate_source: 422,
  module_disabled: 422,
  repost_pending: 422,
  unavailable: 503,
};

export class CorrectionError extends Error {
  readonly status: number;
  constructor(
    message: string,
    readonly code: CorrectionRefusalCode,
    readonly detail?: unknown,
    /** The legacy POS refusal code folded into this one (swap routes keep their old wire codes). */
    readonly posCode?: string,
  ) {
    super(message);
    this.name = 'CorrectionError';
    this.status = CORRECTION_STATUS[code];
  }
}

// ── request shapes (contracts/workflow.md) ────────────────────────────────────────────────

export interface VariantPreview {
  mode: 'variant_swap';
  sourceType: 'pos_ticket_line';
  sourceId: string;
  expectedProductId: string;
  replacement: { productId: string };
}
export interface ReceiptLine {
  originalLineId: string;
  itemId: string;
  qty: string;
  rate: string;
  uom: string;
  toWarehouseId: string;
}
export interface ReceiptPreview {
  mode: 'receipt_replace';
  sourceType: 'stock_receipt';
  sourceId: string;
  replacement: { lines: ReceiptLine[] };
}
export type PreviewRequest = VariantPreview | ReceiptPreview;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL = /^(\d{1,9})(\.\d{1,4})?$/;
const MAX_VALUE = 1_000_000_000;

const bad = (why: string): never => {
  throw new CorrectionError(why, 'invalid_request');
};

function exactKeys(o: Record<string, unknown>, keys: string[], where: string) {
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) bad(`${where}: unknown key ${extra[0]}`);
  for (const k of keys) if (!(k in o)) bad(`${where}: missing ${k}`);
}
const asObject = (v: unknown, where: string): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(where);
function uuid(v: unknown, where: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) bad(`${where} must be a lowercase UUID`);
  return v as string;
}

/** Positive fixed-4-decimal normalization: ASCII digits, one optional point, <=4 fractional, <=9 integer digits. */
export function normalizeDecimal(v: unknown, where: string): string {
  if (typeof v !== 'string') return bad(`${where} must be a decimal string`);
  const m = DECIMAL.exec(v);
  if (!m) return bad(`${where} must be a positive decimal`);
  const frac = (m[2] ?? '.').slice(1).padEnd(4, '0');
  const out = `${m[1]}.${frac}`;
  if (!(Number(out) > 0)) bad(`${where} must be positive`);
  return out;
}

/** Strict parse; unknown keys and forbidden combinations are `invalid_request`. A public `stock_only` is refused separately. */
export function parsePreviewRequest(raw: unknown): PreviewRequest {
  const o = asObject(raw, 'request must be an object');
  if (o.mode === 'stock_only')
    throw new CorrectionError(
      'stock-only repair is a private owner command',
      'owner_evidence_required',
    );
  if (o.mode === 'variant_swap') {
    exactKeys(o, ['mode', 'sourceType', 'sourceId', 'expectedProductId', 'replacement'], 'request');
    if (o.sourceType !== 'pos_ticket_line') bad('variant_swap needs sourceType pos_ticket_line');
    const r = asObject(o.replacement, 'replacement');
    exactKeys(r, ['productId'], 'replacement');
    return {
      mode: 'variant_swap',
      sourceType: 'pos_ticket_line',
      sourceId: uuid(o.sourceId, 'sourceId'),
      expectedProductId: uuid(o.expectedProductId, 'expectedProductId'),
      replacement: { productId: uuid(r.productId, 'replacement.productId') },
    };
  }
  if (o.mode === 'receipt_replace') {
    exactKeys(o, ['mode', 'sourceType', 'sourceId', 'replacement'], 'request');
    if (o.sourceType !== 'stock_receipt') bad('receipt_replace needs sourceType stock_receipt');
    const r = asObject(o.replacement, 'replacement');
    exactKeys(r, ['lines'], 'replacement');
    if (!Array.isArray(r.lines) || r.lines.length < 1 || r.lines.length > 200)
      bad('replacement.lines must hold 1-200 lines');
    const seen = new Set<string>();
    const lines = (r.lines as unknown[]).map((l, i): ReceiptLine => {
      const w = `lines[${i}]`;
      const lo = asObject(l, w);
      exactKeys(lo, ['originalLineId', 'itemId', 'qty', 'rate', 'uom', 'toWarehouseId'], w);
      const originalLineId = uuid(lo.originalLineId, `${w}.originalLineId`);
      if (seen.has(originalLineId)) bad(`${w}: duplicate originalLineId`);
      seen.add(originalLineId);
      const uom = typeof lo.uom === 'string' ? lo.uom.trim().normalize('NFC') : '';
      if (uom.length < 1 || uom.length > 80) bad(`${w}.uom must be 1-80 characters`);
      const qty = normalizeDecimal(lo.qty, `${w}.qty`);
      const rate = normalizeDecimal(lo.rate, `${w}.rate`);
      if (Number(qty) * Number(rate) > MAX_VALUE) bad(`${w}: value exceeds the admitted limit`);
      return {
        originalLineId,
        itemId: uuid(lo.itemId, `${w}.itemId`),
        qty,
        rate,
        uom,
        toWarehouseId: uuid(lo.toWarehouseId, `${w}.toWarehouseId`),
      };
    });
    return {
      mode: 'receipt_replace',
      sourceType: 'stock_receipt',
      sourceId: uuid(o.sourceId, 'sourceId'),
      replacement: { lines },
    };
  }
  return bad('unsupported mode');
}

export function parseReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim().normalize('NFC') : '';
  if (reason.length < 1 || reason.length > 1000) bad('reason must be 1-1000 characters');
  return reason;
}

// ── canonical hashing ────────────────────────────────────────────────────────────────────

export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new Error('canonicalJson: undefined');
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))
    throw new Error('canonicalJson: non-finite or negative zero');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}
export const sha256Hex = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex');

/** Hash of exactly the preview preimage (excludes reason, random ids and wall clock). */
export function previewHashOf(body: {
  orgId: string;
  actorProfileId: string;
  request: PreviewRequest;
  sourceSnapshot: unknown;
  stockSnapshot: unknown;
  policySnapshot: unknown;
}): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, valuation: null, ...body }));
}
/** operationKey is the lookup key, never part of the hashed intent. */
export function payloadHashOf(body: {
  orgId: string;
  actorProfileId: string;
  request: PreviewRequest;
  previewHash: string;
  reason: string;
}): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, valuation: null, ...body }));
}

// ── receipt period policy v1 ─────────────────────────────────────────────────────────────

/** `YYYY-MM` of an instant in an IANA zone. */
export const monthInZone = (at: Date, timeZone: string): string => instantMonthKey(at, timeZone);

export interface ReceiptPeriodEvaluation {
  policyId: typeof RECEIPT_PERIOD_POLICY_ID;
  accountingTimezone: string;
  originalMonth: string;
  currentMonth: string;
  periodLockRows: string[];
}
/** Absent finance settings -> policy_unverified (no Lima fallback here); a locked original or current month -> period_locked. */
export function evaluateReceiptPeriod(input: {
  settingsTimezone: string | null;
  originalPostedAt: Date;
  now: Date;
  lockedPeriods: ReadonlySet<string>;
}): ReceiptPeriodEvaluation {
  if (!input.settingsTimezone)
    throw new CorrectionError('finance settings are not configured', 'policy_unverified');
  const originalMonth = monthInZone(input.originalPostedAt, input.settingsTimezone);
  const currentMonth = monthInZone(input.now, input.settingsTimezone);
  const hit = [...new Set([originalMonth, currentMonth])]
    .sort()
    .filter((m) => input.lockedPeriods.has(m));
  if (hit.length) throw new CorrectionError(`period ${hit[0]} is locked`, 'period_locked');
  return {
    policyId: RECEIPT_PERIOD_POLICY_ID,
    accountingTimezone: input.settingsTimezone,
    originalMonth,
    currentMonth,
    periodLockRows: [],
  };
}

// ── receipt replacement rules (closed change set) ───────────────────────────────────────

export interface OriginalReceiptLine {
  id: string;
  itemId: string;
  qty: string;
  rate: string | null;
  uom: string | null;
  toWarehouseId: string | null;
}
const num = (s: string | null) => (s == null ? NaN : Number(s));

export interface ReceiptDelta {
  lineId: string;
  kind: 'qty' | 'rate';
  before: string;
  after: string;
}
/**
 * Same item, warehouse and UOM per original line; the complete original line set exactly once, in
 * order; per line a quantity change OR a rate change (not both); at least one change. Unchanged rate
 * means numeric equality with the stored rate. Returns the deltas, or throws invalid_request.
 */
export function validateReceiptReplacement(
  original: readonly OriginalReceiptLine[],
  replacement: readonly ReceiptLine[],
): ReceiptDelta[] {
  if (original.length !== replacement.length)
    bad('replacement must cover every original line exactly once');
  const deltas: ReceiptDelta[] = [];
  original.forEach((o, i) => {
    const r = replacement[i];
    if (r.originalLineId !== o.id) bad('replacement lines must follow the original line order');
    if (r.itemId !== o.itemId) bad('a receipt correction cannot change the item');
    if (r.toWarehouseId !== o.toWarehouseId)
      bad('a receipt correction cannot change the warehouse');
    if ((o.uom ?? '') !== r.uom) bad('a receipt correction cannot change the UOM');
    const qtyChanged = num(o.qty) !== Number(r.qty);
    const rateChanged = num(o.rate) !== Number(r.rate);
    if (qtyChanged && rateChanged) bad('change quantity or rate per line, not both');
    if (qtyChanged) deltas.push({ lineId: o.id, kind: 'qty', before: o.qty, after: r.qty });
    if (rateChanged)
      deltas.push({ lineId: o.id, kind: 'rate', before: o.rate ?? '', after: r.rate });
  });
  if (!deltas.length) bad('the replacement changes nothing');
  return deltas;
}

/** True when a delta list changes stock VALUE (rate), which is owner-only. */
export const changesValue = (deltas: readonly ReceiptDelta[]) =>
  deltas.some((d) => d.kind === 'rate');

// ── frozen sale lines ────────────────────────────────────────────────────────────────────

export interface FrozenLine {
  itemId: string;
  qty: number;
  fromWarehouseId: string;
}
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * New issue lines for a swap: the ORIGINAL submitted lines minus what the old product issued plus what
 * the new product issues (stock units, by item). Never regenerated from current recipes. A removal
 * larger than the frozen quantity means the recipe drifted: stock_drift. Items keep their original
 * warehouse; new items use `defaultWarehouseId` (the original entry's issue warehouse).
 */
export function transformFrozenIssueLines(
  original: readonly FrozenLine[],
  oldByItem: ReadonlyMap<string, number>,
  newByItem: ReadonlyMap<string, number>,
  defaultWarehouseId: string,
): FrozenLine[] {
  const qty = new Map<string, number>();
  const wh = new Map<string, string>();
  const order: string[] = [];
  for (const l of original) {
    if (!qty.has(l.itemId)) order.push(l.itemId);
    qty.set(l.itemId, r4((qty.get(l.itemId) ?? 0) + l.qty));
    wh.set(l.itemId, wh.get(l.itemId) ?? l.fromWarehouseId);
  }
  for (const [itemId, q] of oldByItem) {
    const left = r4((qty.get(itemId) ?? 0) - q);
    if (left < -0.0001)
      throw new CorrectionError(
        `the sale issued less ${itemId} than the product consumed`,
        'stock_drift',
      );
    qty.set(itemId, Math.max(left, 0));
  }
  for (const [itemId, q] of [...newByItem].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!qty.has(itemId)) order.push(itemId);
    qty.set(itemId, r4((qty.get(itemId) ?? 0) + q));
    wh.set(itemId, wh.get(itemId) ?? defaultWarehouseId);
  }
  return order
    .filter((id) => (qty.get(id) ?? 0) > 0.0001)
    .map((itemId) => ({ itemId, qty: qty.get(itemId)!, fromWarehouseId: wh.get(itemId)! }));
}
