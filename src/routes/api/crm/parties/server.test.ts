import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  searchParties: vi.fn(),
  ensureParty: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: mocks.getCoreCtx,
}));

vi.mock('$server/services/party.service', () => ({
  ensureParty: mocks.ensureParty,
  searchParties: mocks.searchParties,
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
  });

  function post(body: Record<string, unknown>) {
    return POST({
      locals: {},
      request: new Request('https://hub.example.test/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as never);
  }

  it('an 11-digit document defaults to RUC + company', async () => {
    await post({ name: 'Acme SAC', docNumber: '20512345678' });
    expect(mocks.ensureParty).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      expect.objectContaining({ docType: 'RUC', type: 'company', docNumber: '20512345678' }),
    );
  });

  it('an 8-digit document keeps the DNI + person default', async () => {
    await post({ name: 'Ana', docNumber: '60525600' });
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
});
