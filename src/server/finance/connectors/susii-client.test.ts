import { describe, it, expect, vi, afterEach } from 'vitest';
import { SusiiClient } from './susii-client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.restoreAllMocks());

describe('SusiiClient', () => {
  it('logs in (DRF Token) and paginates sales following .next', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))                                   // login
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: 'https://api.susii.com/v1/sales/sales/?page=2', results: [{ id: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: null, results: [{ id: 2 }] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    const got: unknown[] = [];
    for await (const page of c.salesPages({ businessId: 5922 })) got.push(...page);
    expect(got).toEqual([{ id: 1 }, { id: 2 }]);
    // login used Token header on subsequent calls
    const secondCall = fetchMock.mock.calls[1];
    expect((secondCall[1] as RequestInit).headers).toMatchObject({ Authorization: 'Token TOK' });
  });
});
