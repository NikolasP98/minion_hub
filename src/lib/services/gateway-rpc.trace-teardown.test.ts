import { afterEach, expect, test, vi } from 'vitest';
import { gwTrace } from './gateway-rpc';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Master run 45915362768 went red on this: the retry timer outlived the test page.
test('the diagnostics retry timer stops quietly once the page is gone', () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('window', {}); // a page whose PostHog has not loaded: the retry timer starts
  gwTrace('test.phase');
  expect(vi.getTimerCount()).toBeGreaterThan(0);

  Reflect.deleteProperty(globalThis, 'window'); // the page is torn down
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  vi.advanceTimersByTime(60_000);
  expect(vi.getTimerCount()).toBe(0);
});
