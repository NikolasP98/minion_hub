import type { MoneyDraft, PlanInstalment } from './checkout-money';
import { DecimalInputError, decimalToMinorExact } from '$lib/money/decimal';

export const PLAN_OPERATION_LEGACY_VERSION = 1 as const;
export const PLAN_OPERATION_VERSION = 2 as const;
export const PLAN_OPERATION_MAX_DUE_ROWS = 365;
export const PLAN_OPERATION_MAX_CART_ROWS = 250;
export const PLAN_OPERATION_MAX_BYTES = 128 * 1024;
const NUMERIC_12_2_MAX_MINOR = 999_999_999_999n;

export const PLAN_OPERATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlanOperationStage =
  'prepared' | 'unknown' | 'committed_refresh' | 'continuation_pending' | 'continuation_applied';

export interface PlanOperationIdentity {
  actorId: string;
  orgId: string;
}

/** Canonical wallet authority returned by the create-authorized identity preflight. */
export interface PlanCanonicalIdentity {
  partyId: string | null;
  crmContactId: string | null;
  clientKey: string;
  identityStatus: 'active';
}

export type PlanCurrencyIntent = { kind: 'omitted' } | { kind: 'explicit'; value: string };

export interface LegacyPlanOpenIntent {
  partyId: string | null;
  crmContactId: string | null;
  bookingId: string | null;
  productId: string | null;
  title: string;
  totalAmount: number;
  currency: PlanCurrencyIntent;
  dueSchedule: PlanInstalment[] | null;
  note: string | null;
}

export interface PlanOpenIntent extends LegacyPlanOpenIntent {
  clientKey: string;
}

export interface FrozenPlanCartRow {
  productId: string;
  kind: 'product' | 'service' | 'bundle';
  qty: MoneyDraft;
  unitPrice: MoneyDraft | null;
  discount: MoneyDraft;
  bookingId: string | null;
  redemptionId: string | null;
  planId: string | null;
}

export type PlanOpenContinuation =
  | {
      kind: 'account';
      clientKey: string;
    }
  | {
      kind: 'sell';
      partyId: string;
      bookingId: string | null;
      preCart: FrozenPlanCartRow[];
      postCart: FrozenPlanCartRow[] | null;
    };

interface PendingPlanOperationBase {
  actorId: string;
  orgId: string;
  operationId: string;
  stage: PlanOperationStage;
  planId: string | null;
  continuation: PlanOpenContinuation;
}

export type PendingPlanOperation =
  | (PendingPlanOperationBase & {
      version: typeof PLAN_OPERATION_LEGACY_VERSION;
      intent: LegacyPlanOpenIntent;
    })
  | (PendingPlanOperationBase & {
      version: typeof PLAN_OPERATION_VERSION;
      intent: PlanOpenIntent;
    });

export type PlanPersistenceErrorCode =
  | 'identity_invalid'
  | 'record_invalid'
  | 'record_too_large'
  | 'storage_unavailable'
  | 'lock_unavailable'
  | 'storage_read'
  | 'storage_write'
  | 'storage_readback'
  | 'operation_replaced'
  | 'owner_cancelled';

export class PlanPersistenceError extends Error {
  readonly code: PlanPersistenceErrorCode;

  constructor(code: PlanPersistenceErrorCode) {
    super(code);
    this.name = 'PlanPersistenceError';
    this.code = code;
  }
}

function fixedString(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function optionalId(value: unknown): value is string | null {
  return value === null || fixedString(value, 200);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validMoneyDraft(value: unknown, nullable = false): boolean {
  if (nullable && value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function validGregorianDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function exactPositiveMoney(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  try {
    const minor = decimalToMinorExact(value);
    return minor > 0n && minor <= NUMERIC_12_2_MAX_MINOR ? minor : null;
  } catch (error) {
    if (error instanceof DecimalInputError) return null;
    throw error;
  }
}

function validSchedule(value: unknown, principalMinor: bigint): value is PlanInstalment[] | null {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length > PLAN_OPERATION_MAX_DUE_ROWS) return false;
  if (value.length === 0) return true;
  let previousDate = '';
  let totalMinor = 0n;
  for (const row of value) {
    if (
      !plainObject(row) ||
      !exactKeys(row, ['dueOn', 'amount']) ||
      !validGregorianDate(row.dueOn) ||
      row.dueOn < previousDate
    ) {
      return false;
    }
    const amountMinor = exactPositiveMoney(row.amount);
    if (amountMinor === null) return false;
    previousDate = row.dueOn;
    totalMinor += amountMinor;
  }
  return totalMinor === principalMinor;
}

function validCurrency(value: unknown): value is PlanCurrencyIntent {
  if (!plainObject(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'omitted') return exactKeys(value, ['kind']);
  return (
    value.kind === 'explicit' && exactKeys(value, ['kind', 'value']) && fixedString(value.value, 8)
  );
}

function validLegacyIntent(value: unknown): value is LegacyPlanOpenIntent {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'partyId',
      'crmContactId',
      'bookingId',
      'productId',
      'title',
      'totalAmount',
      'currency',
      'dueSchedule',
      'note',
    ])
  ) {
    return false;
  }
  const principalMinor = exactPositiveMoney(value.totalAmount);
  return (
    optionalId(value.partyId) &&
    optionalId(value.crmContactId) &&
    optionalId(value.bookingId) &&
    optionalId(value.productId) &&
    Boolean(value.partyId || value.crmContactId) &&
    fixedString(value.title, 500) &&
    value.title === value.title.trim() &&
    principalMinor !== null &&
    validCurrency(value.currency) &&
    validSchedule(value.dueSchedule, principalMinor) &&
    (value.note === null ||
      (typeof value.note === 'string' &&
        value.note.length <= 2_000 &&
        value.note === value.note.trim()))
  );
}

function validIntent(value: unknown): value is PlanOpenIntent {
  return (
    plainObject(value) &&
    exactKeys(value, [
      'clientKey',
      'partyId',
      'crmContactId',
      'bookingId',
      'productId',
      'title',
      'totalAmount',
      'currency',
      'dueSchedule',
      'note',
    ]) &&
    fixedString(value.clientKey, 200) &&
    validLegacyIntent(
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'clientKey')),
    )
  );
}

function validCartRow(value: unknown): value is FrozenPlanCartRow {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'productId',
      'kind',
      'qty',
      'unitPrice',
      'discount',
      'bookingId',
      'redemptionId',
      'planId',
    ])
  ) {
    return false;
  }
  return (
    fixedString(value.productId, 200) &&
    ['product', 'service', 'bundle'].includes(String(value.kind)) &&
    validMoneyDraft(value.qty) &&
    validMoneyDraft(value.unitPrice, true) &&
    validMoneyDraft(value.discount) &&
    optionalId(value.bookingId) &&
    optionalId(value.redemptionId) &&
    optionalId(value.planId)
  );
}

function validCart(value: unknown): value is FrozenPlanCartRow[] {
  return (
    Array.isArray(value) &&
    value.length <= PLAN_OPERATION_MAX_CART_ROWS &&
    value.every(validCartRow)
  );
}

export function isFrozenPlanCart(value: unknown): value is FrozenPlanCartRow[] {
  return validCart(value);
}

function validContinuation(value: unknown): value is PlanOpenContinuation {
  if (!plainObject(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'account') {
    return exactKeys(value, ['kind', 'clientKey']) && fixedString(value.clientKey, 200);
  }
  return (
    value.kind === 'sell' &&
    exactKeys(value, ['kind', 'partyId', 'bookingId', 'preCart', 'postCart']) &&
    fixedString(value.partyId, 200) &&
    optionalId(value.bookingId) &&
    validCart(value.preCart) &&
    (value.postCart === null || validCart(value.postCart))
  );
}

function validStage(value: unknown): value is PlanOperationStage {
  return [
    'prepared',
    'unknown',
    'committed_refresh',
    'continuation_pending',
    'continuation_applied',
  ].includes(String(value));
}

export function isPlanOperationIdentity(identity: PlanOperationIdentity): boolean {
  return fixedString(identity.actorId, 200) && fixedString(identity.orgId, 200);
}

export function isPendingPlanOperation(value: unknown): value is PendingPlanOperation {
  if (
    !plainObject(value) ||
    !exactKeys(value, [
      'version',
      'actorId',
      'orgId',
      'operationId',
      'stage',
      'intent',
      'planId',
      'continuation',
    ])
  ) {
    return false;
  }
  if (
    ![PLAN_OPERATION_LEGACY_VERSION, PLAN_OPERATION_VERSION].includes(
      value.version as typeof PLAN_OPERATION_LEGACY_VERSION | typeof PLAN_OPERATION_VERSION,
    ) ||
    !fixedString(value.actorId, 200) ||
    !fixedString(value.orgId, 200) ||
    typeof value.operationId !== 'string' ||
    !PLAN_OPERATION_UUID_RE.test(value.operationId) ||
    !validStage(value.stage) ||
    !optionalId(value.planId) ||
    !validContinuation(value.continuation)
  ) {
    return false;
  }
  if (
    (value.version === PLAN_OPERATION_LEGACY_VERSION && !validLegacyIntent(value.intent)) ||
    (value.version === PLAN_OPERATION_VERSION && !validIntent(value.intent))
  ) {
    return false;
  }
  const needsPlan = ['committed_refresh', 'continuation_pending', 'continuation_applied'].includes(
    value.stage,
  );
  if (needsPlan !== Boolean(value.planId)) return false;
  if (
    (value.stage === 'continuation_pending' || value.stage === 'continuation_applied') &&
    value.continuation.kind === 'sell' &&
    value.continuation.postCart === null
  ) {
    return false;
  }
  return true;
}

export function serializePendingPlanOperation(record: PendingPlanOperation): string {
  if (!isPendingPlanOperation(record)) throw new PlanPersistenceError('record_invalid');
  return JSON.stringify(record);
}

export function pendingPlanOperationBytes(record: PendingPlanOperation): number {
  return new TextEncoder().encode(serializePendingPlanOperation(record)).byteLength;
}

export function freezePlanCart(
  rows: readonly {
    sellable: { productId: string; kind: FrozenPlanCartRow['kind'] };
    qty: MoneyDraft;
    unitPrice: MoneyDraft | null;
    discount: MoneyDraft;
    bookingId?: string | null;
    redemptionId?: string | null;
    planId?: string | null;
  }[],
): FrozenPlanCartRow[] {
  return rows.map((row) => ({
    productId: row.sellable.productId,
    kind: row.sellable.kind,
    qty: row.qty,
    unitPrice: row.unitPrice,
    discount: row.discount,
    bookingId: row.bookingId ?? null,
    redemptionId: row.redemptionId ?? null,
    planId: row.planId ?? null,
  }));
}

export function sameFrozenCart(
  left: readonly FrozenPlanCartRow[],
  right: readonly FrozenPlanCartRow[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
