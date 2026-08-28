import { describe, expect, it, vi } from 'vitest';
import { CustomerPageCache } from './customer-page-cache';

describe('CustomerPageCache', () => {
  it('aborts an obsolete foreground request and keeps the newest result', async () => {
    const pending = new Map<
      string,
      { resolve: (value: string) => void; reject: (reason: unknown) => void }
    >();
    const fetchPage = vi.fn(
      (url: string, signal: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          pending.set(url, { resolve, reject });
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const cache = new CustomerPageCache(fetchPage);

    const old = cache.load('/old');
    const current = cache.load('/current');
    pending.get('/current')!.resolve('current');

    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await expect(current).resolves.toBe('current');
  });

  it('promotes prefetched data without issuing a second request', async () => {
    const fetchPage = vi.fn(async (url: string) => `body:${url}`);
    const cache = new CustomerPageCache(fetchPage);

    await cache.prefetch('/page-2');
    await expect(cache.load('/page-2')).resolves.toBe('body:/page-2');
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('evicts the least-recently-used entry at its bound', async () => {
    const fetchPage = vi.fn(async (url: string) => url);
    const cache = new CustomerPageCache(fetchPage, 2);

    await cache.load('/one');
    await cache.load('/two');
    await cache.load('/one');
    await cache.load('/three');
    await cache.load('/two');

    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('aborts idle prefetches when data is invalidated', async () => {
    let signal: AbortSignal | undefined;
    const fetchPage = vi.fn(
      (_url: string, nextSignal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal = nextSignal;
          nextSignal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const cache = new CustomerPageCache(fetchPage);
    const pending = cache.prefetch('/stale');

    cache.clear();

    expect(signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
