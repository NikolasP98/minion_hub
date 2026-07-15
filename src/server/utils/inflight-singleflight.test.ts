import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareInflight } from './inflight-singleflight';

describe('shareInflight', () => {
  beforeEach(() => {
    delete globalThis.__minionHubInflight;
  });

  it('coalesces concurrent work with the same key', async () => {
    let release!: (value: string) => void;
    const factory = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const first = shareInflight('same', factory);
    const second = shareInflight('same', factory);
    await Promise.resolve();
    release('ready');

    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready']);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('removes settled work so a later caller can refresh it', async () => {
    const factory = vi.fn(async () => factory.mock.calls.length);

    await expect(shareInflight('refresh', factory)).resolves.toBe(1);
    await expect(shareInflight('refresh', factory)).resolves.toBe(2);
  });

  it('can briefly reuse a successful result to absorb reload bursts', async () => {
    vi.useFakeTimers();
    const factory = vi.fn(async () => factory.mock.calls.length);

    await expect(shareInflight('recent', factory, 100)).resolves.toBe(1);
    await expect(shareInflight('recent', factory, 100)).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(101);
    await expect(shareInflight('recent', factory, 100)).resolves.toBe(2);
    vi.useRealTimers();
  });
});
