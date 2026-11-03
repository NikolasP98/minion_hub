import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ctx: vi.fn(), update: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.ctx }));
vi.mock('$server/services/personal-agent-provisioner', async (orig) => ({
  ...(await orig<typeof import('$server/services/personal-agent-provisioner')>()),
  updatePersonalAgentSettings: mocks.update,
}));
vi.mock('$server/services/personal-agent.service', () => ({
  getPersonalAgent: vi.fn(),
  provisionPersonalAgent: vi.fn(),
  updateProvisioningStatus: vi.fn(),
}));
import { POST } from './+server';

const ctx = { tenantId: 'org', profileId: 'profile' };
const call = (body: unknown, user: unknown = { id: 'profile' }) =>
  POST({
    locals: { user },
    request: new Request('http://localhost/api/personal-agent/settings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue(ctx);
  mocks.update.mockResolvedValue('personal-profile');
});

describe('POST /api/personal-agent/settings', () => {
  it('refuses a missing user with 401 and touches nothing', async () => {
    expect((await call({ name: 'A' }, null)).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses when there is no core context', async () => {
    mocks.ctx.mockResolvedValue(null);
    expect((await call({ name: 'A' })).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('patches the signed-in user’s agent and drops unknown fields incl. an agentId', async () => {
    const res = await call({ name: 'Ana', agentId: 'personal-other', contextMode: 'x' });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(ctx, 'profile', { name: 'Ana' });
    expect(await res.json()).toEqual({ ok: true, agentId: 'personal-profile' });
  });
  it('rejects a body with no editable field', async () => {
    expect((await call({ agentId: 'personal-other' })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
