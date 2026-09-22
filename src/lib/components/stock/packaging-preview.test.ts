import { describe, it, expect } from 'vitest';
import { packagingFacts, packagingMode, round4 } from './packaging-preview';

describe('packagingMode', () => {
  it('reads the tier layout from the stored conversion, never from a stored flag', () => {
    expect(packagingMode({ uom: 'caja' })).toBe('count');
    expect(packagingMode({ uom: 'caja', consumptionUom: 'ml', unitsPerStockUom: 500 })).toBe(
      'bulk',
    );
    expect(
      packagingMode({
        uom: 'caja',
        consumptionUom: 'ml',
        unitsPerStockUom: 200,
        subunitsPerStockUom: 20,
      }),
    ).toBe('pieces');
    // A usage unit with no total is not a conversion.
    expect(packagingMode({ uom: 'caja', consumptionUom: 'ml', unitsPerStockUom: 0 })).toBe('count');
  });
});

describe('packagingFacts', () => {
  const box = { uom: 'box', consumptionUom: 'ml', unitsPerStockUom: 200, subunitsPerStockUom: 20 };

  it('translates on-hand across all three tiers and splits the open package', () => {
    const f = packagingFacts(box, 3.4);
    expect(f.mode).toBe('pieces');
    expect(f.gaugeMax).toBe(10);
    expect(f.pieces).toBe(20);
    expect(f.perPackage).toBe(200);
    expect(f.wholePackages).toBe(3);
    expect(f.openPieces).toBeCloseTo(8);
    expect(f.diagramFill).toBeCloseTo(8);
    expect(f.onHandPieces).toBeCloseTo(68);
    expect(f.onHandUsage).toBeCloseTo(680);
    expect(f.drawable).toBe(true);
  });

  it('draws a sealed full package when nothing is open, and nothing when out of stock', () => {
    expect(packagingFacts(box, 2).diagramFill).toBe(20);
    expect(packagingFacts(box, 0).diagramFill).toBe(0);
  });

  it('bulk has no pieces tier; the gauge is the whole package', () => {
    const f = packagingFacts({ uom: 'bottle', consumptionUom: 'ml', unitsPerStockUom: 500 }, 2.5);
    expect(f.mode).toBe('bulk');
    expect(f.pieces).toBe(0);
    expect(f.gaugeMax).toBe(500);
    expect(f.onHandPieces).toBe(0);
    expect(f.onHandUsage).toBe(1250);
    expect(f.drawable).toBe(false);
  });

  it('count mode has no conversion at all', () => {
    const f = packagingFacts({ uom: 'sesión' }, 7);
    expect(f.mode).toBe('count');
    expect(f.gaugeMax).toBe(0);
    expect(f.onHandUsage).toBe(0);
    expect(f.wholePackages).toBe(7);
  });

  it('more pieces than the grid can draw is reported, not drawn', () => {
    const f = packagingFacts({ ...box, subunitsPerStockUom: 100, unitsPerStockUom: 1000 }, 1);
    expect(f.pieces).toBe(100);
    expect(f.drawable).toBe(false);
  });
});

describe('round4', () => {
  it('keeps a repeating decimal from drifting the stored total', () => {
    expect(round4(500 / 3)).toBe(166.6667);
    expect(round4(20 * 10)).toBe(200);
  });
});
