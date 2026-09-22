import { describe, expect, it, vi } from 'vitest';
import { checkedRefresh } from './refresh';
import { completeRowSaves, saveRowPatch } from '$lib/components/data-table/row-save';

describe('checked SvelteKit refresh', () => {
  it('checks the page after invalidate resolves and preserves the error boundary', async () => {
    const page: { status: number; error: unknown } = { status: 200, error: null };
    const error = { message: 'Load failed' };
    await expect(
      checkedRefresh(
        async () => {
          page.status = 500;
          page.error = error;
        },
        () => page,
      ),
    ).rejects.toThrow('Page refresh failed (500)');
    expect(page.error).toBe(error);
    expect(page.status).toBe(500);
  });

  it('keeps a successful PATCH committed when resolved invalidation publishes a route error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const page: { status: number; error: unknown } = { status: 200, error: null };
    const invalidate = vi.fn(async () => {
      page.status = 500;
      page.error = { message: 'read failed' };
    });
    try {
      const saved = await saveRowPatch('/api/stock/items/id', { name: 'kept' });
      const outcome = await completeRowSaves([saved], () => checkedRefresh(invalidate, () => page));
      expect(saved.status).toBe('succeeded');
      expect(outcome.status).toBe('committed-refreshing');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('classifies standalone toggle refresh errors without replaying PATCH', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    try {
      const result = await saveRowPatch('/api/pos/sellables/id', { active: true }, () =>
        checkedRefresh(
          async () => {},
          () => ({ status: 200, error: { message: 'load failed' } }),
        ),
      );
      expect(result.status).toBe('committed-refreshing');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('accepts a healthy refreshed page', async () => {
    await expect(
      checkedRefresh(
        async () => {},
        () => ({ status: 200, error: null }),
      ),
    ).resolves.toBeUndefined();
  });
});
