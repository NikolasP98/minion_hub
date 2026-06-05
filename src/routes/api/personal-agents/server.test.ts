import { describe, it, expect, vi } from 'vitest';

vi.mock('$server/services/personal-agent.service', () => ({
  listOrgPersonalAgents: vi
    .fn()
    .mockResolvedValue([{ agentId: 'personal-u1', userName: 'Alice' }]),
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: vi.fn() }));

// The route resolves the core (Supabase) ctx via getCoreCtx now.
const mockGetCoreCtx = vi.fn();
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: () => mockGetCoreCtx() }));

import { GET } from './+server';

const callGET = (locals: unknown) =>
  GET({ locals } as unknown as Parameters<typeof GET>[0]);

describe('GET /api/personal-agents', () => {
  it('401s without a core ctx', async () => {
    mockGetCoreCtx.mockResolvedValueOnce(null);
    await expect(callGET({})).rejects.toMatchObject({ status: 401 });
  });
  it('returns the org personal-agent list', async () => {
    mockGetCoreCtx.mockResolvedValueOnce({ db: {}, tenantId: 't1' });
    const res = await callGET({ user: { id: 'u1' } });
    const body = await res.json();
    expect(body).toEqual({ personalAgents: [{ agentId: 'personal-u1', userName: 'Alice' }] });
  });
});
