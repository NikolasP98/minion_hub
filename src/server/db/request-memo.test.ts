import { describe, expect, test, vi } from 'vitest';
import { memoRequest, shouldActivateRequestMemo, withRequestMemo } from './request-memo';

describe('shouldActivateRequestMemo (hooks.server.ts requestMemoHandle gate)', () => {
  test('GET and HEAD activate the store', () => {
    expect(shouldActivateRequestMemo('GET')).toBe(true);
    expect(shouldActivateRequestMemo('HEAD')).toBe(true);
  });

  test('POST (and every other write verb) never activates the store — a write must always read fresh', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(shouldActivateRequestMemo(method)).toBe(false);
    }
  });

  test('a POST request therefore never sees a memoised value, even for a key a prior GET populated', async () => {
    const fn = vi.fn(async () => 'from-get');
    // Simulates the GET request that populated this key...
    await withRequestMemo(() => memoRequest('shared-key', fn));
    // ...and the POST request that follows: requestMemoHandle would NOT call
    // withRequestMemo for it (shouldActivateRequestMemo('POST') is false),
    // so memoRequest here runs outside any store — a fresh call, not a hit.
    expect(shouldActivateRequestMemo('POST')).toBe(false);
    await memoRequest('shared-key', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('memoRequest', () => {
  test('no-ops outside an active store — every call runs fn fresh', async () => {
    const fn = vi.fn(async () => 'value');
    await memoRequest('k', fn);
    await memoRequest('k', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('shares the in-flight promise for the same key within one store', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return `result-${calls}`;
    });

    const [a, b] = await withRequestMemo(() =>
      Promise.all([memoRequest('k', fn), memoRequest('k', fn)]),
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe('result-1');
    expect(b).toBe('result-1');
  });

  test('shares the settled result for a later (sequential) call with the same key', async () => {
    const fn = vi.fn(async () => 'settled');
    const [a, b] = await withRequestMemo(async () => {
      const first = await memoRequest('k', fn);
      const second = await memoRequest('k', fn);
      return [first, second];
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe('settled');
    expect(b).toBe('settled');
  });

  test('different keys never collide', async () => {
    const fn = vi.fn(async () => 'v');
    await withRequestMemo(async () => {
      await memoRequest('k1', fn);
      await memoRequest('k2', fn);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('evicts a rejected promise so a retry (same or another caller) is not poisoned', async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('transient');
      return 'recovered';
    });

    await withRequestMemo(async () => {
      await expect(memoRequest('k', fn)).rejects.toThrow('transient');
      await expect(memoRequest('k', fn)).resolves.toBe('recovered');
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('one request-memo store does not leak into a sibling store', async () => {
    const fn = vi.fn(async () => 'v');
    await withRequestMemo(() => memoRequest('k', fn));
    await withRequestMemo(() => memoRequest('k', fn));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
