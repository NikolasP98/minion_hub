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
const call = (body = '{}') =>
  POST({
    locals: { user: { id: 'profile' } },
    request: new Request('http://localhost/api/personal-agent/create', {
      method: 'POST',
      body,
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
  // Spec 045 A3 audit F4: an error-state agent may already exist on the gateway
  // with a personality; an empty retry (the browser's auto-provision) must not
  // send config.patch with a blank one.
  it('keeps an error-state agent’s runtime personality on an empty retry', async () => {
    mocks.pending.mockResolvedValue({
      agent: { agentId: 'personal-legacy', displayName: 'Mine', provisioningStatus: 'error' },
    });
    mocks.activate.mockResolvedValue('personal-legacy');
    expect((await call()).status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith(ctx, 'profile', {});
  });
  it('still applies an identity the caller names for an error-state agent', async () => {
    mocks.pending.mockResolvedValue({
      agent: { agentId: 'personal-legacy', displayName: 'Mine', provisioningStatus: 'error' },
    });
    mocks.activate.mockResolvedValue('personal-legacy');
    expect((await call('{"name":"Ana","personality":"warm"}')).status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith(ctx, 'profile', {
      identity: { name: 'Ana', personality: 'warm', personalityText: undefined },
    });
  });
  it('reports a binding conflict instead of claiming activation', async () => {
    mocks.activate.mockRejectedValue(new PersonalAgentBindingError('Assignment conflict'));
    expect((await call()).status).toBe(409);
  });
});
