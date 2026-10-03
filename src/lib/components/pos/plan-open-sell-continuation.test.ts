import { describe, expect, it, vi } from 'vitest';
import { freezePlanCart, type FrozenPlanCartRow } from './plan-open-persistence';
import { PlanContinuationError, type PreparedSellContinuation } from './plan-open-operation.svelte';
import {
  applyPreparedSellContinuation,
  parseStoredSellCart,
  projectStoredSellCart,
  readFrozenPlanCart,
  requireRestorablePendingSale,
  sellCartStorageKey,
  serializeFrozenPlanCart,
  type PlanCartProjection,
} from './plan-open-sell-continuation';
import type { CartLine, SellCartSellable } from './SellCart.svelte';

class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];
  failWrite = false;
  mismatch = false;

  getItem(key: string): string | null {
    this.calls.push('get');
    const value = this.values.get(key) ?? null;
    return this.mismatch && value ? value + 'x' : value;
  }

  setItem(key: string, value: string): void {
    this.calls.push('set');
    if (this.failWrite) throw new Error('quota');
    this.values.set(key, value);
  }
}

function sellable(id = 'product-1'): SellCartSellable {
  return {
    productId: id,
    code: id,
    name: 'Service',
    category: null,
    unitPrice: 100,
    active: true,
    kind: 'service',
    itemId: null,
    stockQty: null,
    hasMapping: false,
  };
}

function line(id = 'product-1'): CartLine {
  return {
    sellable: sellable(id),
    qty: '1',
    unitPrice: '100',
    discount: '0',
  };
}

function planLine(planId = 'plan-1', amount: number | string = 25): CartLine {
  return {
    sellable: {
      ...sellable('plan:' + planId),
      name: 'Treatment plan',
      unitPrice: typeof amount === 'number' ? amount : Number(amount),
    },
    qty: 1,
    unitPrice: amount,
    discount: 0,
    planId,
  };
}

function projection(
  overrides: Partial<PlanCartProjection['plans'][number]['plan']> = {},
  amount = 25,
): PlanCartProjection {
  return {
    clientKey: 'party:party-1',
    plans: [
      {
        plan: { id: 'plan-1', title: 'Treatment plan', status: 'open', ...overrides },
        remaining: amount,
        nextDue: { amount },
        scheduleIssue: null,
      },
    ],
  };
}

function prepared(pre: CartLine[], post: CartLine[]): PreparedSellContinuation {
  return { preCart: freezePlanCart(pre), postCart: freezePlanCart(post) };
}

describe('sell plan continuation', () => {
  it('writes and verifies the post cart before replacing the live cart', () => {
    const storage = new MemoryStorage();
    const key = sellCartStorageKey('org-1');
    let current = [line()];
    const state = prepared(current, [planLine()]);
    storage.values.set(key, serializeFrozenPlanCart(state.preCart));
    const replace = vi.fn((next: CartLine[]) => {
      expect(readFrozenPlanCart(storage, key)).toEqual(state.postCart);
      current = next;
    });

    applyPreparedSellContinuation({
      prepared: state,
      postLines: [planLine()],
      currentLines: () => current,
      replaceLines: replace,
      storage,
      storageKey: key,
      allowReplace: false,
    });

    expect(replace).toHaveBeenCalledTimes(1);
    expect(freezePlanCart(current)).toEqual(state.postCart);
    expect(storage.calls.slice(-3)).toEqual(['set', 'get', 'get']);
  });

  it('recognizes an already-applied post state without replacing it twice', () => {
    const storage = new MemoryStorage();
    const key = sellCartStorageKey('org-1');
    const current = [planLine()];
    const state = prepared([line()], current);
    storage.values.set(key, serializeFrozenPlanCart(state.postCart));
    const replace = vi.fn();

    applyPreparedSellContinuation({
      prepared: state,
      postLines: current,
      currentLines: () => current,
      replaceLines: replace,
      storage,
      storageKey: key,
      allowReplace: false,
    });

    expect(replace).not.toHaveBeenCalled();
    expect(storage.calls).toEqual(['get']);
  });

  it('blocks a third cart state until explicit replacement is allowed', () => {
    const storage = new MemoryStorage();
    const key = sellCartStorageKey('org-1');
    let current = [line('product-other')];
    const state = prepared([line()], [planLine()]);
    storage.values.set(key, serializeFrozenPlanCart(freezePlanCart(current)));
    const options = {
      prepared: state,
      postLines: [planLine()],
      currentLines: () => current,
      replaceLines: (next: CartLine[]) => (current = next),
      storage,
      storageKey: key,
    };

    expect(() => applyPreparedSellContinuation({ ...options, allowReplace: false })).toThrowError(
      expect.objectContaining<Partial<PlanContinuationError>>({
        code: 'cart_restore_required',
      }),
    );

    applyPreparedSellContinuation({ ...options, allowReplace: true });
    expect(freezePlanCart(current)).toEqual(state.postCart);
  });

  it('does not publish live state when cart storage cannot be verified', () => {
    const storage = new MemoryStorage();
    const key = sellCartStorageKey('org-1');
    const original = [line()];
    let current = original;
    const state = prepared(original, [planLine()]);
    storage.values.set(key, serializeFrozenPlanCart(state.preCart));
    storage.mismatch = true;

    expect(() =>
      applyPreparedSellContinuation({
        prepared: state,
        postLines: [planLine()],
        currentLines: () => current,
        replaceLines: (next) => (current = next),
        storage,
        storageKey: key,
        allowReplace: true,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanContinuationError>>({
        code: 'cart_projection_invalid',
      }),
    );
    expect(current).toBe(original);
  });

  it.each([
    ['missing', []],
    ['inactive', [{ ...sellable(), active: false }]],
  ])('blocks explicit replacement when a frozen product is %s', (_label, sellables) => {
    expect(() =>
      requireRestorablePendingSale({
        rows: freezePlanCart([line()]),
        sellables,
        expectedPartyId: 'party-1',
        projection: projection(),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanContinuationError>>({
        code: 'cart_projection_invalid',
      }),
    );
  });
});

describe('projection-backed synthetic plan cart reload', () => {
  it('parses legacy catalog rows by deriving kind from the current sellable', () => {
    const raw = JSON.stringify([
      {
        productId: 'product-1',
        qty: '2',
        unitPrice: '10',
        discount: '0',
        bookingId: null,
        redemptionId: null,
        planId: null,
      },
    ]);

    expect(parseStoredSellCart(raw, [sellable()])).toEqual([
      expect.objectContaining({ productId: 'product-1', kind: 'service', qty: '2' }),
    ]);
  });

  it('retains a synthetic plan row until its authenticated account projection arrives', () => {
    const row = freezePlanCart([planLine()])[0];

    expect(
      projectStoredSellCart({
        rows: [row],
        sellables: [sellable()],
        expectedPartyId: 'party-1',
      }),
    ).toEqual({ status: 'needs-plan', rows: [row] });
  });

  it('restores the exact instalment after the operation slot is gone', () => {
    const rows = freezePlanCart([planLine()]);
    const restored = projectStoredSellCart({
      rows,
      sellables: [sellable()],
      expectedPartyId: 'party-1',
      projection: projection(),
    });

    expect(restored.status).toBe('ready');
    if (restored.status !== 'ready') throw new Error('expected ready cart');
    expect(freezePlanCart(restored.lines)).toEqual(rows);
  });

  it.each([
    ['wrong party', { ...projection(), clientKey: 'party:other' }],
    ['missing plan', { ...projection(), plans: [] }],
    ['closed plan', projection({ status: 'settled' })],
    ['changed amount', projection({}, 30)],
  ])('keeps the stored row blocked for %s', (_label, account) => {
    const rows: FrozenPlanCartRow[] = freezePlanCart([planLine()]);
    const result = projectStoredSellCart({
      rows,
      sellables: [sellable()],
      expectedPartyId: 'party-1',
      projection: account,
    });

    expect(result.status).not.toBe('ready');
    if (result.status === 'ready') throw new Error('expected blocked cart');
    expect(result.rows).toEqual(rows);
  });
});
