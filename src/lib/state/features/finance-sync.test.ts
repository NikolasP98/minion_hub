import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('financeSync HTTP failure behavior', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('does not enter the running state when start is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Sync denied' }, { status: 403 })),
    );
    const { financeSync } = await import('./finance-sync.svelte');

    await financeSync.start('susii');

    expect(financeSync.active).toBe(false);
    expect(financeSync.status).toBe('error');
    expect(financeSync.error).toBe('Sync denied');
  });

  test('only enters the running state after a successful start response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({ active: true, status: 'running', total: 2, processed: 0 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { financeSync } = await import('./finance-sync.svelte');

    await financeSync.start('susii');

    expect(financeSync.active).toBe(true);
    expect(financeSync.status).toBe('running');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    financeSync.stop();
  });
});
