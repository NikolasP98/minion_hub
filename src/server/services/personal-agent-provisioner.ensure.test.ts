import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  provision: vi.fn(),
  prepare: vi.fn(),
  commit: vi.fn(),
  failure: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('./personal-agent.service', () => ({
  getPersonalAgent: mocks.get,
  provisionPersonalAgent: mocks.provision,
  updateProvisioningStatus: vi.fn(),
}));
vi.mock('./personal-agent-binding', () => ({
  preparePersonalAgentBinding: mocks.prepare,
  commitPersonalAgentBinding: mocks.commit,
  recordPersonalAgentBindingFailure: mocks.failure,
  recordPersonalAgentClientFailure: vi.fn(),
  PersonalAgentBindingError: class extends Error {},
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallToInstance: mocks.rpc }));
import { ensureActivePersonalAgent } from './personal-agent-provisioner';
const ctx = { db: {} as never, tenantId: 'org-1', profileId: 'user-1' };
const params = { userId: 'user-1', email: 'u@example.com' };
const agentRow = (status: string, serverId: string | null = null) => ({
  agentId: 'personal-legacy',
  provisioningStatus: status,
  serverId,
  retryCount: 0,
  lastRetryAt: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({
    target: { url: 'ws://127.0.0.1:18789', token: 'fixture-token' },
    agent: { agent_id: 'personal-legacy', provisioning_status: 'pending' },
  });
  mocks.rpc.mockImplementation(async (_url, _token, method) =>
    method === 'agents.list' ? { agents: [{ id: 'personal-legacy' }] } : {},
  );
});
describe('hosted personal-agent entrypoint', () => {
  it('leaves an existing active binding unchanged', async () => {
    mocks.get.mockResolvedValue(agentRow('active', 'gateway-1'));
    expect(await ensureActivePersonalAgent(ctx, params)).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith(ctx, params.userId);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('creates a NULL pending row before verified runtime activation', async () => {
    mocks.get.mockResolvedValue(null);
    mocks.provision.mockResolvedValue(agentRow('pending'));
    expect(await ensureActivePersonalAgent(ctx, params)).toBe(true);
    expect(mocks.provision).toHaveBeenCalledWith(ctx, { ...params, serverId: '' });
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(['agents.create', 'agents.list']);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
  it('repairs an active NULL row without recreating or deriving its legacy ID', async () => {
    mocks.get.mockResolvedValue(agentRow('active'));
    mocks.prepare.mockResolvedValue({
      target: { url: 'ws://local', token: 'fixture' },
      agent: { agent_id: 'personal-legacy', provisioning_status: 'active' },
    });
    expect(await ensureActivePersonalAgent(ctx, params)).toBe(true);
    expect(mocks.rpc.mock.calls.map((call) => call[2])).toEqual(['agents.list']);
    expect(mocks.provision).not.toHaveBeenCalled();
  });
  it('does not bind after a runtime failure', async () => {
    mocks.get.mockResolvedValue(agentRow('pending'));
    mocks.rpc.mockRejectedValue(new Error('unreachable'));
    expect(await ensureActivePersonalAgent(ctx, params)).toBe(false);
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledOnce();
  });
  it('respects backoff for active unbound rows and rejects a different owner', async () => {
    mocks.get.mockResolvedValue({ ...agentRow('active'), retryCount: 2, lastRetryAt: Date.now() });
    expect(await ensureActivePersonalAgent(ctx, params)).toBe(false);
    expect(await ensureActivePersonalAgent(ctx, { ...params, userId: 'someone-else' })).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
