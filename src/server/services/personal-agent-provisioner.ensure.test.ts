import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPersonalAgent: vi.fn(),
  provisionPersonalAgent: vi.fn(),
  updateProvisioningStatus: vi.fn(),
  gatewayCall: vi.fn(),
  endpoint: vi.fn(),
  credentials: vi.fn(),
  bind: vi.fn(),
}));

vi.mock('./personal-agent.service', () => ({
  getPersonalAgent: mocks.getPersonalAgent,
  bindUnassignedPersonalAgentGateway: mocks.bind,
  provisionPersonalAgent: mocks.provisionPersonalAgent,
  updateProvisioningStatus: mocks.updateProvisioningStatus,
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallToInstance: mocks.gatewayCall }));
vi.mock('./gateway-lease.service', () => ({ resolveChannelEndpoint: mocks.endpoint }));
vi.mock('./gateway.pg.service', () => ({ getGatewayCredentialsById: mocks.credentials }));
vi.mock('$server/gateway-channel', () => ({ currentBuildChannel: () => 'prd' }));

import { ensureActivePersonalAgent } from './personal-agent-provisioner';

const ctx = { db: {} as never, tenantId: 'org-1' };
const params = { userId: 'user-1', email: 'u@example.com' };

function agentRow(status: string, retryCount = 0, lastRetryAt: number | null = null) {
  return {
    id: 'pa-1',
    userId: 'user-1',
    agentId: 'personal-user-1',
    serverId: 'gateway-1',
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
  vi.resetAllMocks();
  mocks.endpoint.mockResolvedValue({ gatewayId: 'gateway-1', serverId: 'server-1' });
  mocks.credentials.mockResolvedValue({ url: 'wss://assigned.example', token: 'fixture-token' });
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
    expect(mocks.gatewayCall).toHaveBeenCalledWith(
      'wss://assigned.example',
      'fixture-token',
      'agents.create',
      {
        name: 'personal-user-1',
        workspace: '~/.minion/agents/personal-user-1/workspace',
      },
    );
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

describe('canonical gateway placement', () => {
  it('does not fall back to a global gateway when the org has none', async () => {
    mocks.endpoint.mockResolvedValue(null);
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(false);
    expect(mocks.provisionPersonalAgent).not.toHaveBeenCalled();
    expect(mocks.gatewayCall).not.toHaveBeenCalled();
  });
  it('persists the selected gateway while provisioning a new agent', async () => {
    mocks.getPersonalAgent.mockResolvedValue(null);
    mocks.provisionPersonalAgent.mockResolvedValue(agentRow('pending'));
    await ensureActivePersonalAgent(ctx, params);
    expect(mocks.provisionPersonalAgent).toHaveBeenCalledWith(ctx, {
      ...params,
      serverId: 'gateway-1',
    });
  });
  it('never moves an existing personal agent to another gateway', async () => {
    mocks.getPersonalAgent.mockResolvedValue({
      ...agentRow('active'),
      serverId: 'another-gateway',
    });
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(false);
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.gatewayCall).not.toHaveBeenCalled();
  });
  it('repairs an unassigned row and re-reads the concurrent assignment before provisioning', async () => {
    mocks.getPersonalAgent
      .mockResolvedValueOnce({ ...agentRow('active'), serverId: null })
      .mockResolvedValueOnce({ ...agentRow('pending'), serverId: 'other-winner' });
    await expect(ensureActivePersonalAgent(ctx, params)).resolves.toBe(false);
    expect(mocks.bind).toHaveBeenCalledWith(ctx, params.userId, 'gateway-1');
    expect(mocks.gatewayCall).not.toHaveBeenCalled();
  });
});
