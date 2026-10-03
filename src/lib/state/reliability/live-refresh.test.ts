import { afterEach, expect, it, vi } from 'vitest';
import { createReliabilityLiveRefresh } from './live-refresh';
afterEach(() => vi.useRealTimers());
it('allows one pending batch and one trailing refresh with at least two seconds between starts', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const owner = createReliabilityLiveRefresh({ current: () => true, refresh });
  const first = owner.run();
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 100; i++) owner.notify();
  await vi.advanceTimersByTimeAsync(1000);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await first;
  await vi.advanceTimersByTimeAsync(999);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 100; i++) owner.notify();
  owner.dispose();
  finish();
  await vi.advanceTimersByTimeAsync(10000);
  expect(refresh).toHaveBeenCalledTimes(2);
});
it('checks ownership again when a queued microtask starts', async () => {
  let current = true;
  const refresh = vi.fn(async () => {});
  const owner = createReliabilityLiveRefresh({ current: () => current, refresh });
  const pending = owner.run();
  current = false;
  await pending;
  expect(refresh).not.toHaveBeenCalled();
});
