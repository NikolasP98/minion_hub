import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  derivePersonalAgentId,
  provisionPersonalAgent,
  getPersonalAgent,
  updatePersonalAgent,
  updateProvisioningStatus,
  ensurePersonalAgentOnLogin,
  listPendingAgents,
  deletePersonalAgent,
  listOrgPersonalAgents,
} from './personal-agent.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-pa-id-000000000001',
  nowMs: () => 1_700_000_000_000,
}));

// personal_agents now keys on gateway_id/profile_id; stub the resolvers so unit
// tests stay hermetic (the real ones hit getCoreDb).
vi.mock('$server/services/gateway.pg.service', () => ({
  resolveGatewayId: () => Promise.resolve('gw-1'),
  resolveServerId: () => Promise.resolve('srv-1'),
}));

// user_agents is still on Turso; provisionPersonalAgent builds a Turso ctx via
// getDb() for the migration-path assignAgentToUser write. Stub both.
vi.mock('$server/db/client', () => ({ getDb: () => ({ __turso: true }) }));
const mockAssignAgentToUser =
  vi.fn<(ctx: unknown, userId: string, agentId: string, serverId: string) => Promise<void>>();
vi.mock('./user-agents.service', () => ({
  assignAgentToUser: (ctx: unknown, userId: string, agentId: string, serverId: string) =>
    mockAssignAgentToUser(ctx, userId, agentId, serverId),
}));

// pg rows are typed for PostgresJsDatabase; the mock db is structural — cast.
const ctx = (db: unknown) => ({ db: db as never, tenantId: 't1' });
const TS = new Date(1_700_000_000_000);
const pgRow = (over: Record<string, unknown> = {}) => ({
  id: 'mock-pa-id-000000000001',
  profileId: 'prof-1',
  agentId: 'personal-user-1',
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
  ...over,
});

describe('derivePersonalAgentId', () => {
  it('returns personal-{userId}', () => {
    expect(derivePersonalAgentId('user-abc-123')).toBe('personal-user-abc-123');
  });

  it('is deterministic for the same userId', () => {
    expect(derivePersonalAgentId('u1')).toBe(derivePersonalAgentId('u1'));
  });
});

describe('provisionPersonalAgent', () => {
  it('creates a personal_agents row with status pending and deterministic agentId', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'prof-1' }], // resolveProfileId select profiles
      undefined, // insert personal_agents
      undefined, // update profiles.personalAgentId
      [pgRow()], // re-select after insert
    ]);
    const result = await provisionPersonalAgent(ctx(db), {
      userId: 'user-1',
      email: 'nik@example.com',
      serverId: 'srv-1',
    });
    expect(result.agentId).toBe('personal-user-1');
    expect(result.provisioningStatus).toBe('pending');
    expect(result.serverId).toBe('srv-1'); // reverse-resolved from gateway_id
    expect(db.insert).toHaveBeenCalled();
  });

  it('calls assignAgentToUser (migration path) when a serverId is given', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'prof-1' }], undefined, undefined, [pgRow()]]);
    await provisionPersonalAgent(ctx(db), {
      userId: 'user-1',
      email: 'nik@example.com',
      serverId: 'srv-1',
    });
    expect(mockAssignAgentToUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
      'user-1',
      'personal-user-1',
      'srv-1',
    );
  });

  it('updates profiles.personalAgentId for fast lookup', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'prof-1' }], undefined, undefined, [pgRow()]]);
    await provisionPersonalAgent(ctx(db), {
      userId: 'user-1',
      email: 'nik@example.com',
      serverId: 'srv-1',
    });
    expect(db.update).toHaveBeenCalled();
  });

  it('throws when no profile exists for the user', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // resolveProfileId -> no profile
    await expect(
      provisionPersonalAgent(ctx(db), { userId: 'ghost', email: 'g@x.com', serverId: '' }),
    ).rejects.toThrow(/No profile/);
  });
});

describe('getPersonalAgent', () => {
  it('returns the reshaped personal agent row for a userId', async () => {
    const { db, resolve } = createMockDb();
    resolve([pgRow({ provisioningStatus: 'active' })]);
    const result = await getPersonalAgent(ctx(db), 'user-1');
    expect(result?.agentId).toBe('personal-user-1');
    expect(result?.userId).toBe('user-1');
    expect(result?.provisioningStatus).toBe('active');
    expect(result?.createdAt).toBe(TS.getTime());
    expect(db.select).toHaveBeenCalled();
  });

  it('returns null if no personal agent exists', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await getPersonalAgent(ctx(db), 'user-1');
    expect(result).toBeNull();
  });
});

describe('updatePersonalAgent', () => {
  it('updates avatarUrl (the only remaining hub-DB-owned field)', async () => {
    const { db } = createMockDb();
    await updatePersonalAgent(ctx(db), 'user-1', { avatarUrl: 'https://example.com/a.png' });
    expect(db.update).toHaveBeenCalled();
  });
});

describe('updateProvisioningStatus', () => {
  it('transitions pending -> provisioning', async () => {
    const { db } = createMockDb();
    await updateProvisioningStatus(ctx(db), 'user-1', 'provisioning');
    expect(db.update).toHaveBeenCalled();
  });

  it('transitions provisioning -> active', async () => {
    const { db } = createMockDb();
    await updateProvisioningStatus(ctx(db), 'user-1', 'active');
    expect(db.update).toHaveBeenCalled();
  });

  it('transitions provisioning -> error with error message', async () => {
    const { db } = createMockDb();
    await updateProvisioningStatus(ctx(db), 'user-1', 'error', 'Gateway unreachable');
    expect(db.update).toHaveBeenCalled();
  });
});

describe('ensurePersonalAgentOnLogin', () => {
  it('creates personal agent if none exists', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // getPersonalAgent -> none
      [{ id: 'prof-1' }], // resolveProfileId
      undefined, // insert
      undefined, // update profiles
      [pgRow()], // re-select
    ]);
    const result = await ensurePersonalAgentOnLogin(ctx(db), {
      userId: 'user-1',
      email: 'nik@example.com',
      serverId: 'srv-1',
    });
    expect(result.agentId).toBe('personal-user-1');
  });

  it('returns existing agent without modification', async () => {
    const { db, resolve } = createMockDb();
    resolve([pgRow({ provisioningStatus: 'active' })]);
    const result = await ensurePersonalAgentOnLogin(ctx(db), {
      userId: 'user-1',
      email: 'nik@example.com',
      serverId: 'srv-1',
    });
    expect(result.provisioningStatus).toBe('active');
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('listPendingAgents', () => {
  it('returns reshaped agents with status pending or error', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { pa: pgRow({ id: 'pa-1', provisioningStatus: 'pending' }), legacyUserId: 'u1' },
      { pa: pgRow({ id: 'pa-2', provisioningStatus: 'error', retryCount: 2 }), legacyUserId: 'u2' },
    ]);
    const result = await listPendingAgents(ctx(db));
    expect(result.map((r) => r.userId)).toEqual(['u1', 'u2']);
    expect(db.select).toHaveBeenCalled();
  });

  it('accepts custom maxRetries parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await listPendingAgents(ctx(db), 3);
    expect(result).toEqual([]);
  });
});

describe('deletePersonalAgent', () => {
  it('deletes personal agent row', async () => {
    const { db } = createMockDb();
    await deletePersonalAgent(ctx(db), 'user-1');
    expect(db.delete).toHaveBeenCalled();
  });
});

describe('listOrgPersonalAgents', () => {
  it('returns {agentId, userName} rows from the personalAgents ⋈ profiles join', async () => {
    const rows = [
      { agentId: 'personal-u1', userName: 'Alice' },
      { agentId: 'personal-u2', userName: 'bob@example.com' },
    ];
    const orderBy = vi.fn().mockResolvedValue(rows);
    const innerJoin = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const result = await listOrgPersonalAgents({ db: { select }, tenantId: 't1' } as never);
    expect(result).toEqual(rows);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
