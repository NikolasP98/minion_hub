import { describe, expect, it } from 'vitest';
import { fanDeckTop, fanKey, fanSide } from './fan-out';

describe('fanKey', () => {
  it('keys per column, so day view can fan the same box in either column', () => {
    expect(fanKey('__all__', 'b1')).toBe('__all__ b1');
    expect(fanKey('res-9', 'b1')).not.toBe(fanKey('__all__', 'b1'));
  });
});

describe('fanDeckTop', () => {
  // 3 blocks × 52px + 2 gaps × 4px + 2 × 4px padding = 172px.
  it('sits level with the container when the deck fits below', () => {
    expect(fanDeckTop(100, 3, 52, 4, 4, 784)).toBe(100);
  });
  it('is pulled up just enough to keep the deck inside the track', () => {
    expect(fanDeckTop(700, 3, 52, 4, 4, 784)).toBe(784 - 172);
  });
  it('never goes above the track top', () => {
    expect(fanDeckTop(10, 20, 52, 4, 4, 784)).toBe(0);
  });
});

describe('fanSide', () => {
  const scroller = { left: 0, right: 1000 };
  it('opens to the right while a full column fits before the scroller edge', () => {
    expect(fanSide({ left: 700, right: 850 }, scroller)).toBe('right');
  });
  it('flips to the left on the last visible column', () => {
    expect(fanSide({ left: 860, right: 1000 }, scroller)).toBe('left');
  });
});
