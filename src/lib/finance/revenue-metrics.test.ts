import { describe, expect, it } from 'vitest';
import { revenueBandValues } from './revenue-metrics';

describe('revenue chart loss and deduction toggles', () => {
  const rows = [
    { revenue: 100, tax: 20, opCost: 130 },
    { revenue: 200, tax: 20, opCost: 100 },
    { revenue: -10, tax: 0, opCost: 5 },
  ];
  it('shows negative periods and lets later profit recover the cumulative loss', () => {
    expect(revenueBandValues(rows, { tax: true, cost: true, cumulative: false })).toEqual([
      -50, 80, -15,
    ]);
    expect(revenueBandValues(rows, { tax: true, cost: true, cumulative: true })).toEqual([
      -50, 30, 15,
    ]);
  });
  it('only adds back the deductions the user hid', () => {
    expect(revenueBandValues(rows, { tax: false, cost: true, cumulative: false })).toEqual([
      -30, 100, -15,
    ]);
    expect(revenueBandValues(rows, { tax: true, cost: false, cumulative: false })).toEqual([
      80, 180, -10,
    ]);
    expect(revenueBandValues(rows, { tax: false, cost: false, cumulative: false })).toEqual([
      100, 200, -10,
    ]);
  });
});
