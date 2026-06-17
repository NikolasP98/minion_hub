import { describe, it, expect, vi, afterEach } from 'vitest';
import { SusiiClient } from './susii-client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.restoreAllMocks());

describe('SusiiClient', () => {
  it('logs in (DRF Token) and paginates sales following .next, yielding {results,next}', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: 'https://api.susii.com/v1/sales/sales/?page=2', results: [{ id: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: null, results: [{ id: 2 }] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    const pages: Array<{ results: unknown[]; next: string | null }> = [];
    for await (const page of c.salesPages({ businessId: 5922 })) pages.push(page);
    expect(pages.map((p) => p.results).flat()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(pages[0].next).toBe('https://api.susii.com/v1/sales/sales/?page=2');
    expect(pages[1].next).toBeNull();
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Token TOK' });
  });

  it('resumes from a cursor URL instead of building the first page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 9, next: null, results: [{ id: 7 }] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    const pages = [];
    for await (const p of c.salesPages({ businessId: 5922, cursor: 'https://api.susii.com/v1/sales/sales/?page=3' })) pages.push(p);
    expect(pages[0].results).toEqual([{ id: 7 }]);
    // first authed GET hit the cursor URL verbatim
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.susii.com/v1/sales/sales/?page=3');
  });

  it('count() reads DRF count from a page_size=1 probe', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 1234, next: null, results: [] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    expect(await c.count({ businessId: 5922 })).toBe(1234);
  });
});
