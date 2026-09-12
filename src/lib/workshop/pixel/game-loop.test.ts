import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGameLoop } from './game-loop';

function harness(initial = false) {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  const listeners = new Set<() => void>();
  const media = {
    matches: initial,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    callbacks.set(++next, cb);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const canvas = {
    getContext: () => ({ imageSmoothingEnabled: true }),
  } as unknown as HTMLCanvasElement;
  const sync = vi.fn();
  const update = vi.fn();
  const render = vi.fn();
  const stop = startGameLoop(canvas, { sync, update, render });
  function frame(time: number) {
    const queued = [...callbacks.values()];
    callbacks.clear();
    queued.forEach((cb) => cb(time));
  }
  function motion(value: boolean) {
    media.matches = value;
    listeners.forEach((cb) => cb());
  }
  return { frame, motion, stop, sync, update, render, callbacks, listeners };
}
afterEach(() => vi.unstubAllGlobals());
describe('pixel engine motion preference', () => {
  it('suppresses actual movement initially while syncing and rendering live data', () => {
    const h = harness(true);
    h.frame(100);
    h.frame(200);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.sync).toHaveBeenCalledTimes(2);
    expect(h.render).toHaveBeenCalledTimes(2);
    h.stop();
  });
  it('pauses on live changes and resumes without catching up elapsed time', () => {
    const h = harness();
    h.frame(100);
    h.frame(150);
    expect(h.update).toHaveBeenLastCalledWith(0.05);
    h.motion(true);
    h.frame(10000);
    expect(h.update).toHaveBeenCalledTimes(2);
    h.motion(false);
    h.frame(20000);
    expect(h.update).toHaveBeenLastCalledWith(0);
    h.stop();
  });
  it('removes the preference listener and pending frame on disposal', () => {
    const h = harness();
    h.stop();
    expect(h.listeners.size).toBe(0);
    expect(h.callbacks.size).toBe(0);
    h.motion(false);
    h.frame(100);
    expect(h.render).not.toHaveBeenCalled();
  });
});
