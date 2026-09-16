import { describe, expect, it } from 'vitest';
import { recipeBottleneck } from './pos.service';

// A recipe's stock IS its ingredients' stock: the bottleneck ingredient decides.
describe('recipeBottleneck', () => {
  it('floors on the bottleneck ingredient, needs converted to stock uom', () => {
    const covers = recipeBottleneck(
      [
        { itemId: 'serum', stockQty: 0, consumptionQty: 5 }, // 5 ml per unit, 500 ml/box
        { itemId: 'mask', stockQty: 0, consumptionQty: 1 }, // 1 unit per unit, no conversion
      ],
      new Map([
        ['serum', 2], // 2 boxes = 1000 ml → 200 units
        ['mask', 3], // → 3 units
      ]),
      new Map([
        ['serum', 500],
        ['mask', null],
      ]),
    );
    expect(covers).toBe(3);
  });

  it('is 0 when any needed ingredient has no bin, null when nothing is needed', () => {
    expect(
      recipeBottleneck([{ itemId: 'a', stockQty: 1, consumptionQty: 0 }], new Map(), new Map()),
    ).toBe(0);
    expect(recipeBottleneck([], new Map(), new Map())).toBeNull();
    expect(
      recipeBottleneck([{ itemId: 'a', stockQty: 0, consumptionQty: 0 }], new Map(), new Map()),
    ).toBeNull();
  });
});
