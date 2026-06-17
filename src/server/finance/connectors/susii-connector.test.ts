import { describe, it, expect, vi, afterEach } from 'vitest';
import { susiiConnector } from './susii-connector';

function jsonResponse(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }); }
afterEach(() => vi.restoreAllMocks());

describe('susiiConnector', () => {
  it('pulls + maps sales into canonical invoices', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'T' }))
      .mockResolvedValueOnce(jsonResponse({ next: null, results: [{ id: 1, number: 'BE01-1', is_paid: true, client: { id: 2, document_number: '123' } }] }));
    const out = [];
    for await (const inv of susiiConnector.pull({ config: { businessId: 5922 }, secrets: { username: 'u', password: 'p' } })) out.push(inv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ provider: 'susii', providerRef: '1', clientDocNumber: '123', status: 'paid' });
  });
});
