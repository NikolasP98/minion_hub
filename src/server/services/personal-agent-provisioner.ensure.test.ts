import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPersonalAgent: vi.fn(),
  provisionPersonalAgent: vi.fn(),
  updateProvisioningStatus: vi.fn(),
  gatewayCall: vi.fn(),
}));

vi.mock('./personal-agent.service', () => ({
  getPersonalAgent: mocks.getPersonalAgent,
  provisionPersonalAgent: mocks.provisionPersonalAgent,
  updateProvisioningStatus: mocks.updateProvisioningStatus,
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: mocks.gatewayCall }));

import { ensureActivePersonalAgent } from './personal-agent-provisioner';

const ctx = { db: {} as never, tenantId: 'org-1' };
const params = { userId: 'user-1', email: 'u@example.com' };

function agentRow(status: string, retryCount = 0, lastRetryAt: number | null = null) {
  return {
    id: 'pa-1',
    userId: 'user-1',
    agentId: 'personal-user-1',
    serverId: null,
    displayName: '',
    conversationName: null,
    avatarUrl: null,
    personalityPreset: null,
    personalityText: null,
    personalityConfigured: false,
    provisioningStatus: status,
    provisioningError: null,
    lastRetryAt,
    retryCount,
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureActivePersonalAgent', () => {
  it('returns true immediately when already active (no gateway call)', async () => {
    mocks.getPersonalAgent.mockResolvedValue(agentRow('active'));
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(true);
    expect(mocks.gatewayCall).not.toHaveBeenCalled();
  });

  it('provisions the row when missing, creates the gateway agent, marks active', async () => {
    mocks.getPersonalAgent.mockResolvedValue(null);
    mocks.provisionPersonalAgent.mockResolvedValue(agentRow('pending'));
    mocks.gatewayCall.mockResolvedValue({});
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(true);
    expect(mocks.provisionPersonalAgent).toHaveBeenCalledOnce();
    expect(mocks.gatewayCall).toHaveBeenCalledWith('agents.create', {
      name: 'personal-user-1',
      workspace: '~/.minion/agents/personal-user-1/workspace',
    });
    // provisioning → active transitions, in order
    expect(mocks.updateProvisioningStatus.mock.calls.map((c) => c[2])).toEqual([
      'provisioning',
      'active',
    ]);
  });

  it('tolerates "already exists" from the gateway and still activates', async () => {
    mocks.getPersonalAgent.mockResolvedValue(agentRow('pending'));
    mocks.gatewayCall.mockRejectedValue(new Error('agent already exists'));
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(true);
    expect(mocks.updateProvisioningStatus).toHaveBeenLastCalledWith(ctx, 'user-1', 'active');
  });

  it('returns false and marks error on a real gateway failure (never throws)', async () => {
    mocks.getPersonalAgent.mockResolvedValue(agentRow('pending'));
    mocks.gatewayCall.mockRejectedValue(new Error('gateway unreachable'));
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(false);
    expect(mocks.updateProvisioningStatus).toHaveBeenLastCalledWith(
      ctx,
      'user-1',
      'error',
      'gateway unreachable',
    );
  });

  it('respects the retry backoff window (returns false without calling the gateway)', async () => {
    mocks.getPersonalAgent.mockResolvedValue(agentRow('error', 2, Date.now()));
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(false);
    expect(mocks.gatewayCall).not.toHaveBeenCalled();
  });
});
