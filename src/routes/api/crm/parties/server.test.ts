import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  searchParties: vi.fn(),
  ensureParty: vi.fn(),
  applyRucRegistry: vi.fn(),
  lookupRucConfigured: vi.fn(),
  ensureContactFacetForParty: vi.fn(),
}));

vi.mock('$server/services/ruc-registry', () => ({
  lookupRucConfigured: mocks.lookupRucConfigured,
}));

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: mocks.getCoreCtx,
}));

vi.mock('$server/services/party.service', () => ({
  PartyIdentityConflict: class PartyIdentityConflict extends Error {},
  ensureParty: mocks.ensureParty,
  searchParties: mocks.searchParties,
  applyRucRegistry: mocks.applyRucRegistry,
  ensureContactFacetForParty: mocks.ensureContactFacetForParty,
}));

import { GET, POST } from './+server';

function event(query: string) {
  return {
    locals: {},
    url: new URL(`https://hub.example.test/api/crm/parties?${query}`),
  } as never;
}

describe('GET /api/crm/parties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
    mocks.searchParties.mockResolvedValue([]);
  });

  it('passes the verified-only initial-list flag to the party search', async () => {
    const response = await GET(event('q=&type=person%2Ccompany&verified=1'));

    expect(response.status).toBe(200);
    expect(mocks.searchParties).toHaveBeenCalledWith({ tenantId: 'org-1' }, '', {
      types: ['person', 'company'],
      verifiedOnly: true,
    });
  });

  it('keeps normal text search unrestricted', async () => {
    await GET(event('q=eva&type=person'));

    expect(mocks.searchParties).toHaveBeenCalledWith({ tenantId: 'org-1' }, 'eva', {
      types: ['person'],
      verifiedOnly: false,
    });
  });
});

describe('GET /api/crm/parties?doc=', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
    mocks.searchParties.mockResolvedValue([]);
  });

  it('passes a RUC-only document filter through (stock entries counterpart picker)', async () => {
    await GET(event('q=&doc=ruc'));
    expect(mocks.searchParties).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      '',
      expect.objectContaining({ doc: 'ruc' }),
    );
  });

  it('ignores an unknown doc value', async () => {
    await GET(event('q=&doc=passport'));
    expect(mocks.searchParties).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      '',
      expect.objectContaining({ doc: undefined }),
    );
  });
});

describe('POST /api/crm/parties document defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
    mocks.ensureParty.mockResolvedValue({ id: 'p1', name: 'x', phone9: null, docNumber: null });
    mocks.applyRucRegistry.mockResolvedValue(undefined);
    mocks.lookupRucConfigured.mockResolvedValue({ status: 'found', company: biopas });
    mocks.ensureContactFacetForParty.mockResolvedValue('contact-1');
  });

  const biopas = {
    ruc: '20511417253',
    legalName: 'LABORATORIOS BIOPAS SOCIEDAD ANONIMA CERRADA',
    tradeName: 'LABORATORIOS BIOPAS S.A.C.',
    companyType: 'SOCIEDAD ANONIMA CERRADA',
    address: null,
    active: true,
  };

  /** SvelteKit `error()` throws an HttpError; surface it as a value. */
  async function rejection(
    work: Promise<unknown>,
  ): Promise<{ status: number; body: { code?: string } }> {
    try {
      await work;
    } catch (e) {
      return e as { status: number; body: { code?: string } };
    }
    throw new Error('expected the request to be refused');
  }

  async function post(body: Record<string, unknown>) {
    return await POST({
      locals: {},
      request: new Request('https://hub.example.test/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as never);
  }

  it('an 11-digit document defaults to RUC + company, verified against SUNAT', async () => {
    const res = await post({ name: 'Acme SAC', docNumber: '20511417253' });
    expect(res.status).toBe(201);
    expect(mocks.lookupRucConfigured).toHaveBeenCalledWith('20511417253');
    // The registry's razón social replaces whatever the form typed.
    expect(mocks.ensureParty).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      expect.objectContaining({
        docType: 'RUC',
        type: 'company',
        docNumber: '20511417253',
        name: biopas.legalName,
      }),
    );
    expect(mocks.applyRucRegistry).toHaveBeenCalledWith({ tenantId: 'org-1' }, 'p1', biopas);
  });

  it('an unknown RUC is refused (422 ruc_not_found) and nothing is created', async () => {
    mocks.lookupRucConfigured.mockResolvedValue({ status: 'not_found' });
    const err = await rejection(post({ name: 'Ghost SAC', docNumber: '20999999999' }));
    expect(err.status).toBe(422);
    expect(err.body.code).toBe('ruc_not_found');
    expect(mocks.ensureParty).not.toHaveBeenCalled();
  });

  it('a registry outage is a 502, never an unverified company', async () => {
    mocks.lookupRucConfigured.mockResolvedValue({ status: 'error', message: 'http 500' });
    const err = await rejection(post({ name: 'Acme SAC', docNumber: '20511417253' }));
    expect(err.status).toBe(502);
    expect(mocks.ensureParty).not.toHaveBeenCalled();
  });

  it('a missing PERUDEVS key is a 503 for RUCs only', async () => {
    mocks.lookupRucConfigured.mockResolvedValue({ status: 'unconfigured' });
    const err = await rejection(post({ name: 'Acme SAC', docNumber: '20511417253' }));
    expect(err.status).toBe(503);
    await post({ name: 'Ana', docNumber: '60525600' });
    expect(mocks.ensureParty).toHaveBeenCalledTimes(1);
  });

  it('an 8-digit document keeps the DNI + person default and skips the SUNAT lookup', async () => {
    await post({ name: 'Ana', docNumber: '60525600' });
    expect(mocks.lookupRucConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureParty).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      expect.objectContaining({ docType: 'DNI', type: 'person' }),
    );
  });

  it('an explicit docType/type is never overridden', async () => {
    await post({ name: 'Solo', docNumber: '10512345678', docType: 'RUC', type: 'person' });
    expect(mocks.ensureParty).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      expect.objectContaining({ docType: 'RUC', type: 'person' }),
    );
  });

  it('keeps an 11-digit foreign passport foreign and skips SUNAT', async () => {
    await post({ name: 'Visitor', docNumber: '10512345678', docType: 'PASSPORT', type: 'person' });
    expect(mocks.lookupRucConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureParty).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      expect.objectContaining({ docType: 'PASSPORT', docNumber: '10512345678', type: 'person' }),
    );
  });

  it('creates and links a CRM contact facet with demographics and custom fields', async () => {
    mocks.ensureContactFacetForParty.mockResolvedValue('contact-new');
    await post({ name: 'Ana', dob: '2015-06-04', sex: 'F', customFields: { distrito: 'Lince' } });
    expect(mocks.ensureParty).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      expect.objectContaining({ dob: '2015-06-04', sex: 'F', dedupByPhone: false }),
    );
    expect(mocks.ensureContactFacetForParty).toHaveBeenCalledWith({ tenantId: 'org-1' }, 'p1', {
      displayName: 'x',
      customFields: { distrito: 'Lince', sexo: 'F' },
    });
  });
});
