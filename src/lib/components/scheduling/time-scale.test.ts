import { describe, expect, it } from 'vitest';
import { minPxPerHour } from './time-scale';

describe('minPxPerHour', () => {
  it('fills the viewport when that is taller than the hard floor', () => {
    // 15 rows (07:00–21:00 inclusive) over a 750px viewport, 40px head → 50px/h.
    expect(minPxPerHour({ viewportPx: 790, headPx: 40, hourCount: 15, floorPx: 24 })).toBe(50);
  });

  it('never drops below the hard floor on a short viewport', () => {
    expect(minPxPerHour({ viewportPx: 200, headPx: 40, hourCount: 15, floorPx: 24 })).toBe(24);
  });

  it('falls back to the floor before the viewport is measured', () => {
    expect(minPxPerHour({ viewportPx: 0, headPx: 40, hourCount: 15, floorPx: 24 })).toBe(24);
  });

  it('falls back to the floor for a degenerate hour count', () => {
    expect(minPxPerHour({ viewportPx: 800, headPx: 40, hourCount: 0, floorPx: 24 })).toBe(24);
  });
});
