import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ctx: vi.fn(), pending: vi.fn(), activate: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.ctx }));
vi.mock('$server/services/personal-agent-provisioner', () => ({
  getPendingProvisioningForUser: mocks.pending,
  activatePersonalAgent: mocks.activate,
}));
import { PersonalAgentBindingError } from '$server/services/personal-agent-binding';
import { POST } from './+server';
const ctx = { tenantId: 'org', profileId: 'profile' };
const call = () =>
  POST({
    locals: { user: { id: 'profile' } },
    request: new Request('http://localhost/api/personal-agent/create', {
      method: 'POST',
      body: '{}',
    }),
  } as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue(ctx);
  mocks.pending.mockResolvedValue({ agent: { agentId: 'personal-legacy', displayName: 'Mine' } });
});
describe('explicit hosted creation', () => {
  it('uses the shared verifier and preserves the server-owned identity', async () => {
    mocks.activate.mockResolvedValue('personal-legacy');
    const response = await call();
    expect(response.status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith(ctx, 'profile', {
      identity: { name: 'Mine', personality: '', personalityText: undefined },
    });
    expect(await response.json()).toEqual({ ok: true, agentId: 'personal-legacy' });
  });
  it('preserves runtime personality when retrying an active unbound agent', async () => {
    mocks.pending.mockResolvedValue({
      agent: { agentId: 'personal-legacy', displayName: 'Mine', provisioningStatus: 'active' },
    });
    mocks.activate.mockResolvedValue('personal-legacy');
    expect((await call()).status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith(ctx, 'profile', {});
  });
  it('reports a binding conflict instead of claiming activation', async () => {
    mocks.activate.mockRejectedValue(new PersonalAgentBindingError('Assignment conflict'));
    expect((await call()).status).toBe(409);
  });
});
