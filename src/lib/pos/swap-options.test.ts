import { describe, it, expect } from 'vitest';
import { swapOptions } from './swap-options';

const p = (productId: string, unitPrice: number | null, kind = 'product') => ({
  productId,
  name: productId,
  kind,
  unitPrice,
});

describe('swapOptions (spec 120)', () => {
  const list = [p('faja-m', 120), p('faja-l', 120), p('faja-xl', 150), p('botox', 120, 'service')];

  it('offers other products at the same catalogue price only', () => {
    const out = swapOptions(list, { finProductId: 'faja-m', unitPrice: '0' });
    expect(out.map((s) => s.productId)).toEqual(['faja-l']);
  });

  it('uses the price charged when the product on the line is retired', () => {
    const out = swapOptions(list, { finProductId: 'gone', unitPrice: '150.00' });
    expect(out.map((s) => s.productId)).toEqual(['faja-xl']);
  });

  it('offers nothing when no price is known', () => {
    expect(swapOptions([p('a', null)], { finProductId: 'gone', unitPrice: null })).toEqual([]);
  });
});
