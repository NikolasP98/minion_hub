import { describe, it, expect } from 'vitest';
import { previousRange, deltaPct, calcCtr, calcCpc } from './meta-insights.service';

describe('previousRange', () => {
  it('returns the equal-length window immediately before range', () => {
    expect(previousRange({ from: '2026-06-01', to: '2026-07-01' })).toEqual({
      from: '2026-05-02',
      to: '2026-06-01',
    });
  });

  it('handles single-day ranges', () => {
    expect(previousRange({ from: '2026-07-01', to: '2026-07-02' })).toEqual({
      from: '2026-06-30',
      to: '2026-07-01',
    });
  });
});

describe('deltaPct', () => {
  it('computes percent change', () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
  });
  it('returns null when there is no previous baseline but current is nonzero', () => {
    expect(deltaPct(10, 0)).toBeNull();
  });
  it('returns 0 when both are zero', () => {
    expect(deltaPct(0, 0)).toBe(0);
  });
});

describe('calcCtr / calcCpc', () => {
  it('computes ctr as percent of impressions', () => {
    expect(calcCtr(10, 1000)).toBeCloseTo(1);
  });
  it('returns 0 ctr with no impressions', () => {
    expect(calcCtr(10, 0)).toBe(0);
  });
  it('computes cpc as spend per click', () => {
    expect(calcCpc(50, 25)).toBe(2);
  });
  it('returns 0 cpc with no clicks', () => {
    expect(calcCpc(50, 0)).toBe(0);
  });
});
