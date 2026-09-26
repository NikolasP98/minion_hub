import { describe, expect, it } from 'vitest';
import { nowLineTop, snapTrackMinutes } from './now-line';

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

describe('snapTrackMinutes', () => {
  // Same grid, snapped to quarter hours — what an empty-slot click resolves.
  const at = (offsetY: number) => snapTrackMinutes(offsetY, 7, 21, 56, 15);

  it('snaps a pointer between two slots to the nearest one', () => {
    // 10:07 is 3h07 down the track: 3 * 56 + (7 / 60) * 56 ≈ 174.5px.
    expect(at(174.5)).toBe(10 * 60);
    // 10:08 rounds up to the next quarter instead.
    expect(at(175.5)).toBe(10 * 60 + 15);
  });

  it('lands exactly on a slot boundary', () => {
    expect(at(0)).toBe(7 * 60);
    expect(at(56)).toBe(8 * 60);
    expect(at(14 * 14)).toBe(10 * 60 + 30);
  });

  it('clamps outside the rendered window', () => {
    expect(at(-400)).toBe(7 * 60);
    expect(at(99_999)).toBe(21 * 60);
  });
});
