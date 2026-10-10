import { describe, expect, it } from 'vitest';
import {
  createSellChargeHandoff,
  parseSellChargeHandoff,
  stageSellChargeHandoff,
  type SellChargeHandoff,
} from './sell-charge-handoff';
import { isPendingScheduling, isScheduled } from './schedule-lines';
import type { SellCartSellable } from './SellCart.svelte';

/**
 * An appointment is ONE event with MANY services, so the tray hands the till a
 * LIST of them (v2). Slice 4 (2026-10-10-hub-catalog-service-unification) adds
 * product lines on top (v3: `kind`/`qty` per line). v1/v2 blobs — still in some
 * browser's localStorage from before either change — must keep working.
 */
const IDENTITY = { actorId: 'actor-a', orgId: 'org-a' };

const sellable = (productId: string, kind: 'service' | 'product' = 'service', active = true) =>
  ({
    productId,
    kind,
    name: productId,
    unitPrice: '20',
    active,
  }) as unknown as SellCartSellable;

const SELLABLES = [
  sellable('service-a'),
  sellable('service-b'),
  sellable('service-gone', 'service', false),
  sellable('product-a', 'product'),
];

const line = (bookingId: string, productId: string | null, title = bookingId) => ({
  bookingId,
  productId,
  title,
});

const productLine = (bookingId: string, productId: string, qty = 1, title = productId) => ({
  bookingId,
  productId,
  title,
  kind: 'product' as const,
  qty,
});

describe('createSellChargeHandoff', () => {
  it('stamps v3 and defaults every line to kind=service, qty=1', () => {
    const handoff = createSellChargeHandoff(IDENTITY, {
      lines: [line('b1', 'service-a', 'Cut'), line('b2', 'service-b', 'Color')],
      partyId: 'party-a',
    });
    expect(handoff?.version).toBe(3);
    expect(handoff?.lines).toEqual([
      { bookingId: 'b1', productId: 'service-a', title: 'Cut', kind: 'service', qty: 1 },
      { bookingId: 'b2', productId: 'service-b', title: 'Color', kind: 'service', qty: 1 },
    ]);
  });

  it('keeps an explicit product line, kind and qty included', () => {
    const handoff = createSellChargeHandoff(IDENTITY, {
      lines: [line('b1', 'service-a'), productLine('b1', 'product-a', 2)],
      partyId: 'party-a',
    });
    expect(handoff?.lines).toEqual([
      { bookingId: 'b1', productId: 'service-a', title: 'b1', kind: 'service', qty: 1 },
      { bookingId: 'b1', productId: 'product-a', title: 'product-a', kind: 'product', qty: 2 },
    ]);
  });

  it('refuses a handoff with no lines, a line with no booking, or a malformed kind/qty', () => {
    expect(createSellChargeHandoff(IDENTITY, { lines: [] })).toBeNull();
    expect(createSellChargeHandoff(IDENTITY, { lines: [line('', 'service-a')] })).toBeNull();
    expect(
      createSellChargeHandoff(IDENTITY, {
        lines: [{ ...line('b1', 'product-a'), kind: 'bundle' as never }],
      }),
    ).toBeNull();
    expect(
      createSellChargeHandoff(IDENTITY, { lines: [{ ...line('b1', 'product-a'), qty: 0 }] }),
    ).toBeNull();
  });
});

describe('parseSellChargeHandoff', () => {
  it('round-trips a multi-line v3 blob, services and products alike', () => {
    const raw = JSON.stringify(
      createSellChargeHandoff(IDENTITY, {
        lines: [line('b1', 'service-a'), productLine('b1', 'product-a', 3)],
        customerName: 'Party A',
      }),
    );
    expect(parseSellChargeHandoff(raw, IDENTITY)?.lines).toEqual([
      { bookingId: 'b1', productId: 'service-a', title: 'b1', kind: 'service', qty: 1 },
      { bookingId: 'b1', productId: 'product-a', title: 'product-a', kind: 'product', qty: 3 },
    ]);
  });

  it('still parses a v2 blob — lines with no kind/qty default to service/1', () => {
    const v2 = JSON.stringify({
      version: 2,
      ...IDENTITY,
      lines: [
        { bookingId: 'b1', productId: 'service-a', title: 'Cut' },
        { bookingId: 'b2', productId: null, title: 'Color' },
      ],
      partyId: 'party-a',
      customerName: 'Party A',
      phone: null,
      planId: null,
    });
    const handoff = parseSellChargeHandoff(v2, IDENTITY);
    expect(handoff?.version).toBe(3);
    expect(handoff?.lines).toEqual([
      { bookingId: 'b1', productId: 'service-a', title: 'Cut', kind: 'service', qty: 1 },
      { bookingId: 'b2', productId: null, title: 'Color', kind: 'service', qty: 1 },
    ]);
  });

  it('reads a v1 blob as its one service', () => {
    const v1 = JSON.stringify({
      version: 1,
      ...IDENTITY,
      bookingId: 'b1',
      productId: 'service-a',
      partyId: 'party-a',
      customerName: 'Party A',
      phone: null,
      planId: null,
    });
    const handoff = parseSellChargeHandoff(v1, IDENTITY);
    expect(handoff?.version).toBe(3);
    expect(handoff?.lines).toEqual([
      { bookingId: 'b1', productId: 'service-a', title: '', kind: 'service', qty: 1 },
    ]);
    expect(handoff?.partyId).toBe('party-a');
  });

  it('rejects another actor, an unknown version and a line-less blob', () => {
    const raw = JSON.stringify(createSellChargeHandoff(IDENTITY, { lines: [line('b1', null)] }));
    expect(parseSellChargeHandoff(raw, { actorId: 'actor-b', orgId: 'org-a' })).toBeNull();
    expect(
      parseSellChargeHandoff(JSON.stringify({ version: 4, ...IDENTITY }), IDENTITY),
    ).toBeNull();
    expect(
      parseSellChargeHandoff(JSON.stringify({ version: 3, ...IDENTITY, lines: [] }), IDENTITY),
    ).toBeNull();
  });
});

describe('stageSellChargeHandoff', () => {
  const staged = (input: Parameters<typeof createSellChargeHandoff>[1]) => {
    const handoff = createSellChargeHandoff(IDENTITY, input) as SellChargeHandoff;
    return stageSellChargeHandoff(handoff, SELLABLES);
  };

  it('emits one cart line per resolved service, each stamped with its booking', () => {
    const stage = staged({ lines: [line('b1', 'service-a'), line('b2', 'service-b')] });
    expect(stage.lines.map((l) => [l.sellable.productId, l.bookingId, l.qty])).toEqual([
      ['service-a', 'b1', 1],
      ['service-b', 'b2', 1],
    ]);
    expect(stage.notice).toBe('loaded');
    expect(stage.missingLines).toBe(0);
  });

  it('stages a product line at its own qty, carrying the anchor bookingId', () => {
    const stage = staged({
      lines: [line('b1', 'service-a'), productLine('b1', 'product-a', 2)],
    });
    expect(stage.lines.map((l) => [l.sellable.productId, l.sellable.kind, l.bookingId, l.qty])).toEqual([
      ['service-a', 'service', 'b1', 1],
      ['product-a', 'product', 'b1', 2],
    ]);
    expect(stage.notice).toBe('loaded');
    expect(stage.missingLines).toBe(0);
  });

  it('never stages a product line as pending/scheduled — it is a product, not an appointment', () => {
    // Spec D10: the pending-scheduling tray and account ledgers filter
    // `kind === 'service'` (schedule-lines.ts). A staged product line must
    // fail that filter even though it now carries a real `bookingId`.
    const stage = staged({ lines: [productLine('b1', 'product-a', 2)] });
    const [staged1] = stage.lines;
    expect(staged1.sellable.kind).toBe('product');
    expect(staged1.bookingId).toBe('b1');
    const asLine = {
      kind: staged1.sellable.kind,
      bookingId: staged1.bookingId ?? null,
      planId: null,
    };
    expect(isPendingScheduling(asLine)).toBe(false);
    expect(isScheduled(asLine)).toBe(false);
  });

  it('reports how many lines the cashier has to add by hand', () => {
    const stage = staged({
      lines: [line('b1', 'service-a'), line('b2', null), line('b3', 'service-gone')],
    });
    expect(stage.lines).toHaveLength(1);
    expect(stage.notice).toBe('partial');
    expect(stage.missingLines).toBe(2);
  });

  it('is missing, not partial, when no line resolved', () => {
    const stage = staged({ lines: [line('b1', null)] });
    expect(stage.lines).toEqual([]);
    expect(stage.notice).toBe('missing');
    expect(stage.missingLines).toBe(1);
  });

  it('stages no line for an instalment charge — the plan is the sale', () => {
    const stage = staged({ lines: [line('b1', 'service-a')], planId: 'plan-a' });
    expect(stage.lines).toEqual([]);
    expect(stage.pendingPlanId).toBe('plan-a');
    expect(stage.notice).toBe('loaded');
    expect(stage.missingLines).toBe(0);
  });
});
