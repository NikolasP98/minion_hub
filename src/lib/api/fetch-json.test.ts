import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, fetchJson } from './fetch-json';

afterEach(() => vi.unstubAllGlobals());

describe('fetchJson', () => {
  test('returns typed JSON for a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'a1' })));
    await expect(fetchJson<{ id: string }>('/api/example')).resolves.toEqual({ id: 'a1' });
  });

  test.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [422, 'validation'],
    [409, 'conflict'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %s to %s and preserves a safe server message', async (status, kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Safe explanation' }, { status })),
    );
    const error = await fetchJson('/api/example').catch((value) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, kind, message: 'Safe explanation' });
  });

  test('classifies transport and cancellation failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline')));
    await expect(fetchJson('/api/example')).rejects.toMatchObject({ kind: 'network', status: 0 });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new DOMException('aborted', 'AbortError')),
    );
    await expect(fetchJson('/api/example')).rejects.toMatchObject({ kind: 'cancelled', status: 0 });
  });
});
