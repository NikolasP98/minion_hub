import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  searchParties: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: mocks.getCoreCtx,
}));

vi.mock('$server/services/party.service', () => ({
  ensureParty: vi.fn(),
  searchParties: mocks.searchParties,
}));

import { GET } from './+server';

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
