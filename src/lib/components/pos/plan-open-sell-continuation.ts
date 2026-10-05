import { instalmentPrefillAmount } from './checkout-money';
import {
  freezePlanCart,
  isFrozenPlanCart,
  sameFrozenCart,
  type FrozenPlanCartRow,
} from './plan-open-persistence';
import { PlanContinuationError, type PreparedSellContinuation } from './plan-open-operation.svelte';
import type { CartLine, SellCartSellable } from './SellCart.svelte';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PlanCartProjection {
  clientKey: string;
  plans: Array<{
    plan: {
      id: string;
      title: string;
      status: string;
    };
    remaining: number;
    nextDue: { amount: number } | null;
    scheduleIssue: 'invalid_rows' | 'principal_mismatch' | 'too_many_rows' | null;
  }>;
}

export type StoredCartProjection =
  | { status: 'ready'; lines: CartLine[] }
  | { status: 'needs-plan'; rows: FrozenPlanCartRow[] }
  | { status: 'blocked'; rows: FrozenPlanCartRow[] };

export function sellCartStorageKey(orgId: string): string {
  return 'pos-cart-' + orgId;
}

export function serializeFrozenPlanCart(rows: readonly FrozenPlanCartRow[]): string {
  if (!isFrozenPlanCart(rows)) throw new PlanContinuationError('cart_projection_invalid');
  return JSON.stringify(rows);
}

export function readFrozenPlanCart(storage: StorageLike, key: string): FrozenPlanCartRow[] | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new PlanContinuationError('cart_projection_invalid');
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isFrozenPlanCart(parsed) ? parsed : null;
}

function writeFrozenPlanCart(storage: StorageLike, key: string, rows: FrozenPlanCartRow[]): void {
  const raw = serializeFrozenPlanCart(rows);
  try {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) {
      throw new PlanContinuationError('cart_projection_invalid');
    }
  } catch (error) {
    if (error instanceof PlanContinuationError) throw error;
    throw new PlanContinuationError('cart_projection_invalid');
  }
}

export function applyPreparedSellContinuation(options: {
  prepared: PreparedSellContinuation;
  postLines: CartLine[];
  currentLines: () => CartLine[];
  replaceLines: (lines: CartLine[]) => void;
  storage: StorageLike;
  storageKey: string;
  allowReplace: boolean;
}): void {
  const postLines = freezePlanCart(options.postLines);
  if (!sameFrozenCart(postLines, options.prepared.postCart)) {
    throw new PlanContinuationError('cart_projection_invalid');
  }
  const live = freezePlanCart(options.currentLines());
  const stored = readFrozenPlanCart(options.storage, options.storageKey);
  const atPre =
    sameFrozenCart(live, options.prepared.preCart) &&
    stored !== null &&
    sameFrozenCart(stored, options.prepared.preCart);
  const atPost =
    sameFrozenCart(live, options.prepared.postCart) &&
    stored !== null &&
    sameFrozenCart(stored, options.prepared.postCart);
  if (atPost) return;
  if (!atPre && !options.allowReplace) {
    throw new PlanContinuationError('cart_restore_required');
  }
  writeFrozenPlanCart(options.storage, options.storageKey, options.prepared.postCart);
  options.replaceLines(options.postLines);
  if (!sameFrozenCart(freezePlanCart(options.currentLines()), options.prepared.postCart)) {
    throw new PlanContinuationError('cart_projection_invalid');
  }
}

function storedRow(
  value: unknown,
  sellables: readonly SellCartSellable[],
): FrozenPlanCartRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.productId !== 'string') return null;
  const sellable = sellables.find((candidate) => candidate.productId === row.productId);
  const planId = typeof row.planId === 'string' ? row.planId : null;
  const syntheticPlan = planId !== null && row.productId === 'plan:' + planId;
  if ((!sellable || !sellable.active) && !syntheticPlan) return null;
  const candidate: FrozenPlanCartRow = {
    productId: row.productId,
    kind: syntheticPlan ? 'service' : sellable!.kind,
    qty: row.qty as FrozenPlanCartRow['qty'],
    unitPrice: (row.unitPrice ?? null) as FrozenPlanCartRow['unitPrice'],
    discount: row.discount as FrozenPlanCartRow['discount'],
    bookingId: typeof row.bookingId === 'string' ? row.bookingId : null,
    redemptionId: typeof row.redemptionId === 'string' ? row.redemptionId : null,
    planId,
  };
  return isFrozenPlanCart([candidate]) ? candidate : null;
}

export function parseStoredSellCart(
  raw: string | null,
  sellables: readonly SellCartSellable[],
): FrozenPlanCartRow[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > 250) return [];
  return parsed.flatMap((value) => {
    const row = storedRow(value, sellables);
    return row ? [row] : [];
  });
}

function regularLine(
  row: FrozenPlanCartRow,
  sellables: readonly SellCartSellable[],
): CartLine | null {
  const sellable = sellables.find((candidate) => candidate.productId === row.productId);
  if (!sellable || !sellable.active) return null;
  return {
    sellable,
    qty: row.qty,
    unitPrice: row.unitPrice,
    discount: row.discount,
    bookingId: row.bookingId,
    redemptionId: row.redemptionId,
    planId: row.planId,
  };
}

function projectedPlanLine(
  row: FrozenPlanCartRow,
  projection: PlanCartProjection,
): CartLine | null {
  if (!row.planId || row.productId !== 'plan:' + row.planId) return null;
  const detail = projection.plans.find(
    (candidate) => candidate.plan.id === row.planId && candidate.plan.status === 'open',
  );
  if (!detail) return null;
  const amount = instalmentPrefillAmount(detail);
  if (amount === null) return null;
  const sellable: SellCartSellable = {
    productId: 'plan:' + detail.plan.id,
    code: '',
    name: detail.plan.title,
    category: null,
    unitPrice: amount,
    active: true,
    kind: 'service',
    itemId: null,
    stockQty: null,
    hasMapping: false,
  };
  const line: CartLine = {
    sellable,
    qty: 1,
    unitPrice: amount,
    discount: 0,
    bookingId: row.bookingId,
    redemptionId: null,
    planId: detail.plan.id,
  };
  return sameFrozenCart(freezePlanCart([line]), [row]) ? line : null;
}

export function projectStoredSellCart(options: {
  rows: FrozenPlanCartRow[];
  sellables: readonly SellCartSellable[];
  expectedPartyId: string | null;
  projection?: PlanCartProjection | null;
}): StoredCartProjection {
  const requiresPlan = options.rows.some((row) => row.planId !== null);
  if (requiresPlan) {
    if (
      !options.expectedPartyId ||
      !options.projection ||
      options.projection.clientKey !== 'party:' + options.expectedPartyId
    ) {
      return { status: 'needs-plan', rows: options.rows };
    }
  }
  const lines: CartLine[] = [];
  for (const row of options.rows) {
    const line = row.planId
      ? projectedPlanLine(row, options.projection!)
      : regularLine(row, options.sellables);
    if (!line) return { status: 'blocked', rows: options.rows };
    lines.push(line);
  }
  return { status: 'ready', lines };
}

/** Explicit cart replacement still requires the frozen sale to resolve today. */
export function requireRestorablePendingSale(options: {
  rows: FrozenPlanCartRow[];
  sellables: readonly SellCartSellable[];
  expectedPartyId: string;
  projection: PlanCartProjection;
}): void {
  const restored = projectStoredSellCart(options);
  if (restored.status !== 'ready') {
    throw new PlanContinuationError('cart_projection_invalid');
  }
}
