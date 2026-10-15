import { describe, expect, it } from 'vitest';
import { aggregateBundles, type AggregateRow } from './bundle-aggregates';

const row = (p: Partial<AggregateRow> & { productId: string }): AggregateRow => ({
  kind: 'service',
  unitPrice: null,
  stockQty: null,
  cost: null,
  margin: null,
  marginPct: null,
  costable: false,
  partial: false,
  ...p,
});

describe('aggregateBundles', () => {
  it('rolls up stock/cost/margin from the bundle children (prod example)', () => {
    const rows = [
      row({ productId: 'af2', kind: 'service', cost: 42.38, stockQty: 17 }),
      row({ productId: 'af1', kind: 'bundle', unitPrice: 1800 }),
    ];
    const edges = [{ bundleProductId: 'af1', childProductId: 'af2', qty: 4 }];
    const [, bundle] = aggregateBundles(rows, edges);
    expect(bundle.stockQty).toBe(4);
    expect(bundle.cost).toBe(169.52);
    expect(bundle.margin).toBe(1630.48);
    expect(bundle.marginPct).toBe(90.6);
    expect(bundle.costable).toBe(true);
    expect(bundle.partial).toBe(false);
  });

  it('leaves cost/margin null when any child has no cost, independent of stock', () => {
    const rows = [
      row({ productId: 'a', kind: 'service', cost: 10, stockQty: 5 }),
      row({ productId: 'b', kind: 'service', cost: null, stockQty: 8 }),
      row({ productId: 'bundle', kind: 'bundle', unitPrice: 100 }),
    ];
    const edges = [
      { bundleProductId: 'bundle', childProductId: 'a', qty: 1 },
      { bundleProductId: 'bundle', childProductId: 'b', qty: 1 },
    ];
    const [, , bundle] = aggregateBundles(rows, edges);
    expect(bundle.cost).toBeNull();
    expect(bundle.margin).toBeNull();
    expect(bundle.marginPct).toBeNull();
    // Stock resolves independently of the cost gap.
    expect(bundle.stockQty).toBe(5);
  });

  it('keeps — for a bundle whose child is itself a bundle (one level only)', () => {
    const rows = [
      row({ productId: 'leaf', kind: 'service', cost: 10, stockQty: 5 }),
      row({ productId: 'inner', kind: 'bundle', unitPrice: 50 }),
      row({ productId: 'outer', kind: 'bundle', unitPrice: 100 }),
    ];
    const edges = [
      { bundleProductId: 'inner', childProductId: 'leaf', qty: 1 },
      { bundleProductId: 'outer', childProductId: 'inner', qty: 1 },
    ];
    const result = aggregateBundles(rows, edges);
    const outer = result.find((r) => r.productId === 'outer')!;
    expect(outer.cost).toBeNull();
    expect(outer.stockQty).toBeNull();
    expect(outer.costable).toBe(false);
    // The inner bundle still resolves normally from its own leaf child.
    const inner = result.find((r) => r.productId === 'inner')!;
    expect(inner.cost).toBe(10);
    expect(inner.stockQty).toBe(5);
  });

  it('leaves a bundle with no edges untouched', () => {
    const rows = [row({ productId: 'empty', kind: 'bundle', unitPrice: 100 })];
    const result = aggregateBundles(rows, []);
    expect(result[0].cost).toBeNull();
    expect(result[0].stockQty).toBeNull();
  });
});
