import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ctx: vi.fn(), activate: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.ctx }));
vi.mock('$server/services/personal-agent-provisioner', () => ({
  markActive: mocks.activate,
  markError: vi.fn(),
  getPendingProvisioningForUser: vi.fn(),
}));
import { PersonalAgentBindingError } from '$server/services/personal-agent-binding';
import { POST } from './+server';
const ctx = { tenantId: 'org', profileId: 'profile' };
const call = () =>
  POST({
    locals: { user: { id: 'profile' } },
    request: new Request('http://localhost/api/personal-agent/provision', {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    }),
  } as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue(ctx);
});
describe('legacy activation callback', () => {
  it('does not trust a client success claim when server verification rejects it', async () => {
    mocks.activate.mockRejectedValue(new PersonalAgentBindingError('Assignment conflict'));
    const response = await call();
    expect(response.status).toBe(409);
    expect(mocks.activate).toHaveBeenCalledWith(ctx, 'profile');
    expect(await response.json()).toEqual({ error: 'Assignment conflict' });
  });
  it('accepts completion only after the shared verifier completes', async () => {
    mocks.activate.mockResolvedValue(undefined);
    expect((await call()).status).toBe(200);
  });
});
