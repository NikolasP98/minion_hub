import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const selectRead = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));

// update().eq().is().select() chain → resolves to { data, error }
const updSelect = vi.fn();
const updIs = vi.fn(() => ({ select: updSelect }));
const updEq = vi.fn(() => ({ is: updIs }));
const update = vi.fn(() => ({ eq: updEq }));

const from = vi.fn((table: string) => {
  if (table !== 'organizations') throw new Error(`unexpected table ${table}`);
  return { select: selectRead, update };
});
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from }) }));

const companiesCreate = vi.fn();
const companiesArchive = vi.fn();
vi.mock('$lib/server/paperclip-fetch', () => ({
  paperclipServerClient: () => ({
    companies: { create: companiesCreate, archive: companiesArchive },
  }),
}));

import { getOrgCompanyId, provisionOrgCompany } from './paperclip-company';

beforeEach(() => vi.clearAllMocks());

describe('getOrgCompanyId', () => {
  it('returns the mapped company id', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: 'co-1' }, error: null });
    const id = await getOrgCompanyId('org-1');
    expect(from).toHaveBeenCalledWith('organizations');
    expect(id).toBe('co-1');
  });

  it('returns null when unmapped', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null });
    expect(await getOrgCompanyId('org-1')).toBeNull();
  });

  it('returns null on error', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await getOrgCompanyId('org-1')).toBeNull();
  });
});

const fakeEvent = {} as any;

describe('provisionOrgCompany', () => {
  it('returns the existing mapping without creating', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: 'co-existing' }, error: null });
    const id = await provisionOrgCompany(fakeEvent, 'org-1', 'Acme');
    expect(id).toBe('co-existing');
    expect(companiesCreate).not.toHaveBeenCalled();
  });

  it('creates + persists when unmapped and wins the race', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null });
    companiesCreate.mockResolvedValueOnce({ id: 'co-new', name: 'Acme' });
    updSelect.mockResolvedValueOnce({ data: [{ paperclip_company_id: 'co-new' }], error: null });
    const id = await provisionOrgCompany(fakeEvent, 'org-1', 'Acme');
    expect(companiesCreate).toHaveBeenCalledWith({ name: 'Acme' });
    expect(update).toHaveBeenCalledWith({ paperclip_company_id: 'co-new' });
    expect(updEq).toHaveBeenCalledWith('id', 'org-1');
    expect(updIs).toHaveBeenCalledWith('paperclip_company_id', null);
    expect(id).toBe('co-new');
    expect(companiesArchive).not.toHaveBeenCalled();
  });

  it('archives the duplicate and returns the winner on a lost race', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null })
      .mockResolvedValueOnce({ data: { paperclip_company_id: 'co-winner' }, error: null });
    companiesCreate.mockResolvedValueOnce({ id: 'co-dup', name: 'Acme' });
    updSelect.mockResolvedValueOnce({ data: [], error: null });
    companiesArchive.mockResolvedValueOnce({});
    const id = await provisionOrgCompany(fakeEvent, 'org-1', 'Acme');
    expect(id).toBe('co-winner');
    expect(companiesArchive).toHaveBeenCalledWith('co-dup');
  });

  it('propagates create failures (e.g. 403 not instance-admin)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null });
    companiesCreate.mockRejectedValueOnce(new Error('paperclip 403'));
    await expect(provisionOrgCompany(fakeEvent, 'org-1', 'Acme')).rejects.toThrow(/403/);
  });

  it('archives the orphan and throws when the persist errors (non-race)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { paperclip_company_id: null }, error: null });
    companiesCreate.mockResolvedValueOnce({ id: 'co-new', name: 'Acme' });
    updSelect.mockResolvedValueOnce({ data: null, error: { message: 'violates rls' } });
    companiesArchive.mockResolvedValueOnce({});
    await expect(provisionOrgCompany(fakeEvent, 'org-1', 'Acme')).rejects.toThrow(/rls/);
    expect(companiesArchive).toHaveBeenCalledWith('co-new');
  });
});
