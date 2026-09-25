import { describe, expect, it } from 'vitest';
import { nowLineTop } from './now-line';

describe('nowLineTop', () => {
  // The grid the POS calendar renders: 07:00 → 21:00 at 56px per hour.
  const top = (min: number) => nowLineTop(min, 7, 21, 56);

  it('offsets from the window start for a time inside the window', () => {
    expect(top(7 * 60)).toBe(0);
    expect(top(7 * 60 + 30)).toBe(28);
    expect(top(13 * 60 + 15)).toBeCloseTo(6.25 * 56);
  });

  it('is null before the window starts', () => {
    expect(top(6 * 60 + 59)).toBeNull();
    expect(top(0)).toBeNull();
  });

  it('is null after the window ends', () => {
    expect(top(21 * 60 + 1)).toBeNull();
    expect(top(23 * 60 + 59)).toBeNull();
  });

  it('still draws exactly at the window end', () => {
    expect(top(21 * 60)).toBe(14 * 56);
  });
});
