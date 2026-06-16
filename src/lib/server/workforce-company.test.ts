import { describe, it, expect, vi, beforeEach } from 'vitest';

const rawFetch = vi.fn();
vi.mock('$lib/server/workforce-fetch', () => ({
  workforceRawFetch: (...args: unknown[]) => rawFetch(...args),
}));

const maybeSingle = vi.fn();
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from }) }));

import { ensureWorkforceCompany } from './workforce-company';

const event = {} as any;
beforeEach(() => vi.clearAllMocks());

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

describe('ensureWorkforceCompany', () => {
  it('returns orgId when the company already exists (no create, no supabase read)', async () => {
    rawFetch.mockResolvedValueOnce({ id: 'org-1' }); // GET ok
    const id = await ensureWorkforceCompany(event, 'org-1');
    expect(id).toBe('org-1');
    expect(rawFetch).toHaveBeenCalledTimes(1);
    expect(rawFetch).toHaveBeenCalledWith(event, '/api/companies/org-1');
    expect(from).not.toHaveBeenCalled();
  });

  it('creates the company with id=orgId named after the org when missing (404)', async () => {
    rawFetch.mockRejectedValueOnce(notFound()); // GET → 404
    maybeSingle.mockResolvedValueOnce({ data: { name: 'Acme' } });
    rawFetch.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' }); // POST create
    const id = await ensureWorkforceCompany(event, 'org-1');
    expect(id).toBe('org-1');
    expect(rawFetch).toHaveBeenCalledTimes(2);
    expect(rawFetch).toHaveBeenLastCalledWith(event, '/api/companies', {
      method: 'POST',
      body: JSON.stringify({ id: 'org-1', name: 'Acme' }),
    });
  });

  it('falls back to "Workspace" when the org row has no name', async () => {
    rawFetch.mockRejectedValueOnce(notFound());
    maybeSingle.mockResolvedValueOnce({ data: null });
    rawFetch.mockResolvedValueOnce({});
    await ensureWorkforceCompany(event, 'org-2');
    expect(rawFetch).toHaveBeenLastCalledWith(event, '/api/companies', {
      method: 'POST',
      body: JSON.stringify({ id: 'org-2', name: 'Workspace' }),
    });
  });

  it('rethrows non-404 errors (auth/backend) without creating', async () => {
    rawFetch.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
    await expect(ensureWorkforceCompany(event, 'org-1')).rejects.toThrow(/forbidden/);
    expect(rawFetch).toHaveBeenCalledTimes(1); // GET only, no POST
    expect(from).not.toHaveBeenCalled();
  });
});
