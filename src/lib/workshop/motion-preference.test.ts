import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Ticker } from 'pixi.js';
import { pulseSprite, floatReaction } from './motion-preference';
let reduced = false;
const listeners = new Set<() => void>();
function preference(value: boolean) {
  reduced = value;
  for (const listener of [...listeners]) listener();
}
beforeEach(() => {
  reduced = false;
  listeners.clear();
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    matchMedia: () => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }),
  });
  Ticker.shared.autoStart = false;
  Ticker.shared.stop();
  Ticker.shared.lastTime = -1;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('actual Pixi decorative effects', () => {
  it('respects initial reduction without changing custom sprite geometry', () => {
    const target = new Container();
    target.scale.set(2, 3);
    preference(true);
    pulseSprite(target, 0.2);
    expect([target.scale.x, target.scale.y]).toEqual([2, 3]);
    expect(Ticker.shared.count).toBe(0);
    expect(listeners.size).toBe(0);
    target.destroy();
  });
  it('live reduction resets original scale/alpha and removes ticker and media listeners', () => {
    const target = new Container();
    const glow = new Container();
    target.scale.set(2, 3);
    glow.alpha = 0.4;
    pulseSprite(target, 0.25, glow);
    Ticker.shared.update(100);
    expect(target.scale.x).toBeGreaterThan(2);
    expect(glow.alpha).toBeGreaterThan(0.4);
    preference(true);
    expect([target.scale.x, target.scale.y, glow.alpha]).toEqual([2, 3, 0.4]);
    expect(Ticker.shared.count).toBe(0);
    expect(listeners.size).toBe(0);
    target.destroy();
    glow.destroy();
  });
  it('replacement pulses restore the baseline and target destruction disposes active effects', () => {
    const target = new Container();
    target.scale.set(2, 3);
    pulseSprite(target, 0.2);
    Ticker.shared.update(100);
    pulseSprite(target, 0.2);
    expect([target.scale.x, target.scale.y]).toEqual([2, 3]);
    expect(listeners.size).toBe(1);
    target.destroy();
    expect(listeners.size).toBe(0);
    expect(Ticker.shared.count).toBe(0);
  });
  it('reduced reactions remain visible without float/fade and still expire', () => {
    const reaction = new Container();
    reaction.y = -30;
    reaction.alpha = 0.7;
    preference(true);
    floatReaction(reaction, 40);
    expect(Ticker.shared.count).toBe(0);
    expect([reaction.y, reaction.alpha]).toEqual([-30, 0.7]);
    vi.advanceTimersByTime(1200);
    expect(reaction.destroyed).toBe(true);
    expect(listeners.size).toBe(0);
  });
  it('live reaction reduction restores geometry; explicit destruction clears its expiry', () => {
    const reaction = new Container();
    reaction.y = -30;
    reaction.alpha = 0.7;
    floatReaction(reaction, 40);
    Ticker.shared.update(100);
    expect(reaction.y).toBeLessThan(-30);
    preference(true);
    expect([reaction.y, reaction.alpha]).toEqual([-30, 0.7]);
    preference(false);
    expect(Ticker.shared.count).toBe(1);
    reaction.destroy();
    expect(Ticker.shared.count).toBe(0);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
