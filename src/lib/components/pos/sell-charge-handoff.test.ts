import { describe, expect, it } from 'vitest';
import {
  createSellChargeHandoff,
  parseSellChargeHandoff,
  stageSellChargeHandoff,
  type SellChargeHandoff,
} from './sell-charge-handoff';
import type { SellCartSellable } from './SellCart.svelte';

/**
 * An appointment is ONE event with MANY services, so the tray hands the till a
 * LIST of them (v2). v1 blobs — one booking, one product — are still in some
 * browser's localStorage from before this change and must keep working.
 */
const IDENTITY = { actorId: 'actor-a', orgId: 'org-a' };

const sellable = (productId: string, active = true): SellCartSellable =>
  ({
    productId,
    kind: 'service',
    name: productId,
    unitPrice: '20',
    active,
  }) as unknown as SellCartSellable;

const SELLABLES = [sellable('service-a'), sellable('service-b'), sellable('service-gone', false)];

const line = (bookingId: string, productId: string | null, title = bookingId) => ({
  bookingId,
  productId,
  title,
});

describe('createSellChargeHandoff', () => {
  it('stamps v2 and keeps every service in order', () => {
    const handoff = createSellChargeHandoff(IDENTITY, {
      lines: [line('b1', 'service-a', 'Cut'), line('b2', 'service-b', 'Color')],
      partyId: 'party-a',
    });
    expect(handoff?.version).toBe(2);
    expect(handoff?.lines).toEqual([
      { bookingId: 'b1', productId: 'service-a', title: 'Cut' },
      { bookingId: 'b2', productId: 'service-b', title: 'Color' },
    ]);
  });

  it('refuses a handoff with no services or a line with no booking', () => {
    expect(createSellChargeHandoff(IDENTITY, { lines: [] })).toBeNull();
    expect(createSellChargeHandoff(IDENTITY, { lines: [line('', 'service-a')] })).toBeNull();
  });
});

describe('parseSellChargeHandoff', () => {
  it('round-trips a multi-service v2 blob', () => {
    const raw = JSON.stringify(
      createSellChargeHandoff(IDENTITY, {
        lines: [line('b1', 'service-a'), line('b2', null)],
        customerName: 'Party A',
      }),
    );
    expect(parseSellChargeHandoff(raw, IDENTITY)?.lines).toEqual([
      { bookingId: 'b1', productId: 'service-a', title: 'b1' },
      { bookingId: 'b2', productId: null, title: 'b2' },
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
    expect(handoff?.version).toBe(2);
    expect(handoff?.lines).toEqual([{ bookingId: 'b1', productId: 'service-a', title: '' }]);
    expect(handoff?.partyId).toBe('party-a');
  });

  it('rejects another actor, another version and a line-less v2', () => {
    const raw = JSON.stringify(createSellChargeHandoff(IDENTITY, { lines: [line('b1', null)] }));
    expect(parseSellChargeHandoff(raw, { actorId: 'actor-b', orgId: 'org-a' })).toBeNull();
    expect(
      parseSellChargeHandoff(JSON.stringify({ version: 3, ...IDENTITY }), IDENTITY),
    ).toBeNull();
    expect(
      parseSellChargeHandoff(JSON.stringify({ version: 2, ...IDENTITY, lines: [] }), IDENTITY),
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
    expect(stage.lines.map((l) => [l.sellable.productId, l.bookingId])).toEqual([
      ['service-a', 'b1'],
      ['service-b', 'b2'],
    ]);
    expect(stage.notice).toBe('loaded');
    expect(stage.missingLines).toBe(0);
  });

  it('reports how many services the cashier has to add by hand', () => {
    const stage = staged({
      lines: [line('b1', 'service-a'), line('b2', null), line('b3', 'service-gone')],
    });
    expect(stage.lines).toHaveLength(1);
    expect(stage.notice).toBe('partial');
    expect(stage.missingLines).toBe(2);
  });

  it('is missing, not partial, when no service resolved', () => {
    const stage = staged({ lines: [line('b1', null)] });
    expect(stage.lines).toEqual([]);
    expect(stage.notice).toBe('missing');
    expect(stage.missingLines).toBe(1);
  });

  it('stages no service line for an instalment charge — the plan is the sale', () => {
    const stage = staged({ lines: [line('b1', 'service-a')], planId: 'plan-a' });
    expect(stage.lines).toEqual([]);
    expect(stage.pendingPlanId).toBe('plan-a');
    expect(stage.notice).toBe('loaded');
    expect(stage.missingLines).toBe(0);
  });
});
