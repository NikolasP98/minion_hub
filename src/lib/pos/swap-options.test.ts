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
    const out = swapOptions(list, { finProductId: 'faja-m' });
    expect(out.map((s) => s.productId)).toEqual(['faja-l']);
  });

  it('offers nothing for a retired product: its catalogue price is unknown here', () => {
    expect(swapOptions(list, { finProductId: 'gone' })).toEqual([]);
  });

  it('counts a missing catalogue price as 0, like the server', () => {
    const out = swapOptions([p('a', null), p('b', 0), p('c', 5)], { finProductId: 'a' });
    expect(out.map((s) => s.productId)).toEqual(['b']);
  });
});
