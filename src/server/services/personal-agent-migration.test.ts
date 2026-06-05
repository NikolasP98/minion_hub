import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMigratedPersonalAgent } from './personal-agent-migration';
import { createMockDb } from '$server/test-utils/mock-db';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-migration-id-000001',
  nowMs: () => 1_700_000_000_000,
}));

vi.mock('$server/services/gateway.pg.service', () => ({
  resolveGatewayId: () => Promise.resolve('gw-1'),
  resolveServerId: () => Promise.resolve('srv-1'),
}));

vi.mock('$server/db/client', () => ({ getDb: () => ({ __turso: true }) }));

const mockAssignAgentToUser =
  vi.fn<(ctx: unknown, userId: string, agentId: string, serverId: string) => Promise<void>>();
vi.mock('./user-agents.service', () => ({
  assignAgentToUser: (ctx: unknown, userId: string, agentId: string, serverId: string) =>
    mockAssignAgentToUser(ctx, userId, agentId, serverId),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// pg mock DB sequence for createMigratedPersonalAgent:
// provisionPersonalAgent: select profiles (resolveProfileId) → insert → update
//   profiles → select personal_agents (return); updateProvisioningStatus: update.
const TS = new Date(1_700_000_000_000);
const mockRow = {
  id: 'mock-migration-id-000001',
  profileId: 'prof-1',
  agentId: 'personal-user-922286663',
  gatewayId: 'gw-1',
  displayName: '',
  conversationName: null,
  avatarUrl: null,
  personalityPreset: null,
  personalityText: null,
  personalityConfigured: false,
  provisioningStatus: 'pending',
  provisioningError: null,
  lastRetryAt: null,
  retryCount: 0,
  createdAt: TS,
  updatedAt: TS,
};

function setupMockSequence() {
  const mock = createMockDb();
  mock.resolveSequence([
    [{ id: 'prof-1' }], // resolveProfileId select profiles
    undefined, // insert personal_agents
    undefined, // update profiles.personalAgentId
    [mockRow], // select personal_agents (provisionPersonalAgent return)
    undefined, // updateProvisioningStatus -> 'active'
  ]);
  return mock;
}

const ctx = (db: unknown) => ({ db: db as never, tenantId: 't1' });

describe('createMigratedPersonalAgent', () => {
  const baseParams = {
    userId: 'user-922286663',
    email: 'nik@example.com',
    serverId: 'srv-1',
    originalName: 'PANIK',
    newAgentId: 'personal-user-922286663',
  };

  it('creates personal_agents row via provisionPersonalAgent', async () => {
    const { db } = setupMockSequence();
    const result = await createMigratedPersonalAgent(ctx(db), baseParams);
    expect(result.agentId).toBe('personal-user-922286663');
    expect(db.insert).toHaveBeenCalled();
  });

  it('sets status to active (not pending) after creation', async () => {
    const { db } = setupMockSequence();
    const result = await createMigratedPersonalAgent(ctx(db), baseParams);
    expect(result.provisioningStatus).toBe('active');
    expect(db.update).toHaveBeenCalled();
  });
});
