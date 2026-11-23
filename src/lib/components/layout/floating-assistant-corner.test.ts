import { describe, expect, it } from 'vitest';
import { defaultBottom, raiseAboveReserve } from './floating-assistant-corner';

const size = { w: 44, h: 44 };
const vp = { w: 390, h: 844 };
const M = 20;

describe('floating assistant corner rule', () => {
  it('no reserve: identity', () => {
    const p = { left: 326, top: 780 };
    expect(raiseAboveReserve(p, size, vp, 0, M)).toBe(p);
    expect(defaultBottom(M, 0)).toBe(20);
  });
  it('default place is raised by the reserve', () => {
    expect(defaultBottom(M, 68)).toBe(88);
  });
  it('dragged into the reserved corner: raised above it, left untouched', () => {
    const p = { left: 326, top: 780 };
    expect(raiseAboveReserve(p, size, vp, 68, M)).toEqual({ left: 326, top: 844 - 44 - 20 - 68 });
    expect(p).toEqual({ left: 326, top: 780 });
  });
  it('dragged elsewhere: unchanged', () => {
    const left = { left: 20, top: 780 };
    const high = { left: 326, top: 300 };
    expect(raiseAboveReserve(left, size, vp, 68, M)).toBe(left);
    expect(raiseAboveReserve(high, size, vp, 68, M)).toBe(high);
  });
});
