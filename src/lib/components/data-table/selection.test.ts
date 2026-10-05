import { describe, expect, it } from 'vitest';
import { reconcileProjectionSelection, rowSelectionCounts, sameSelection } from './selection';

describe('DataTable row selection policy', () => {
  it('removes ids absent from a replacement projection', () => {
    const reconciled = reconcileProjectionSelection(new Set(['a', 'b']), ['b', 'c']);
    expect(reconciled).toEqual(new Set(['b']));
    expect(sameSelection(reconciled, new Set(['b']))).toBe(true);
  });

  it('reports hidden all-matching ids explicitly', () => {
    expect(rowSelectionCounts(new Set(['a', 'b', 'c']), ['b'])).toEqual({
      total: 3,
      visible: 1,
      hidden: 2,
    });
  });
});
