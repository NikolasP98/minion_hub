import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, fetchDataset, fetchJson } from './fetch-json';

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

describe('fetchDataset', () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })));

  test('maps a GET 403 "<module>: view required" to the denied marker', async () => {
    respond(403, { message: 'pos: view required' });
    await expect(fetchDataset('/api/pos/x')).resolves.toEqual({ denied: 'pos', verb: 'view' });
  });

  test('passes data through and still throws other errors', async () => {
    respond(200, [1]);
    await expect(fetchDataset('/api/x')).resolves.toEqual([1]);
    respond(403, { message: 'pos: manage required' });
    await expect(fetchDataset('/api/x')).rejects.toBeInstanceOf(ApiError);
    respond(403, { message: 'pos: view required' });
    await expect(fetchDataset('/api/x', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
  });
});
