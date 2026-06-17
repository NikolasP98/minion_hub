import { describe, it, expect, vi, afterEach } from 'vitest';
import { susiiConnector } from './susii-connector';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.restoreAllMocks());

const opts = { config: { businessId: 5922 }, secrets: { username: 'u', password: 'p' } };

describe('susiiConnector.pullPages', () => {
  it('maps each page of sales to canonical invoices and passes through the cursor', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, next: 'https://api.susii.com/n', results: [{ id: 1, is_paid: true, client: null }] }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, next: null, results: [{ id: 2, is_paid: false, client: null }] }));
    const pages = [];
    for await (const p of susiiConnector.pullPages(opts)) pages.push(p);
    expect(pages[0].invoices[0].providerRef).toBe('1');
    expect(pages[0].cursor).toBe('https://api.susii.com/n');
    expect(pages[1].cursor).toBeNull();
  });
});

describe('susiiConnector.count', () => {
  it('delegates to SusiiClient.count', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 42, next: null, results: [] }));
    expect(await susiiConnector.count!(opts)).toBe(42);
  });
});
