import { afterEach, describe, expect, it, vi } from 'vitest';

const searchBrainHybrid = vi.fn();

vi.mock('$server/auth/assistant-principal', () => ({
  resolveAssistantPrincipal: vi.fn().mockResolvedValue({
    principalId: 'profile-1',
    orgId: 'org-1',
    capabilities: {
      roles: ['owner'],
      can: () => true,
      visibleModules: () => ['brains'],
      ownerScoped: () => false,
      fieldLevel: () => 0,
    },
  }),
}));
vi.mock('$server/api/validate', () => ({
  parseBody: vi.fn().mockResolvedValue({
    brainId: '11111111-1111-4111-8111-111111111111',
    query: 'refund policy',
  }),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$server/services/brains.service', () => ({
  brainSourceAccess: () => ({ searchableModules: ['brains'], fieldLevels: { brains: 0 } }),
}));
vi.mock('$server/services/brain-hybrid-retrieval.service', () => ({ searchBrainHybrid }));

const { POST } = await import('./+server');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/gateway/brain-search', () => {
  it('does not expose internal retrieval errors to gateway clients', async () => {
    searchBrainHybrid.mockRejectedValueOnce(new Error('postgres password and internal table name'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = (await POST!({
      locals: {},
      url: new URL('http://localhost/api/gateway/brain-search?agentId=personal-1'),
      request: new Request('http://localhost/api/gateway/brain-search', { method: 'POST' }),
    } as never)) as Response;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'search failed' });
  });
});
