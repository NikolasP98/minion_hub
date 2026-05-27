import { describe, it, expect, vi } from 'vitest';

vi.mock('$server/services/personal-agent.service', () => ({
  listOrgPersonalAgents: vi
    .fn()
    .mockResolvedValue([{ agentId: 'personal-u1', userName: 'Alice' }]),
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: vi.fn() }));

import { GET } from './+server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGET = GET as (event: any) => Promise<any>;

describe('GET /api/personal-agents', () => {
  it('401s without tenantCtx', async () => {
    await expect(callGET({ locals: {} })).rejects.toMatchObject({ status: 401 });
  });
  it('returns the org personal-agent list', async () => {
    const res = await callGET({ locals: { tenantCtx: { db: {}, tenantId: 't1' } } });
    const body = await res.json();
    expect(body).toEqual({ personalAgents: [{ agentId: 'personal-u1', userName: 'Alice' }] });
  });
});
