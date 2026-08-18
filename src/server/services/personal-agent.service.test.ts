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
  loadPersonalAgentForUser,
} from './personal-agent.service';
import { createMockDb } from '$server/test-utils/mock-db';
import type { LoadCtx } from './types';
import type { CoreCtx } from '$server/auth/core-ctx';

beforeEach(() => {
  vi.clearAllMocks();
});

// loadPersonalAgentForUser dynamically imports getCoreCtx (see the source
// comment: kept dynamic so the top-level import surface here stays unchanged).
const mockGetCoreCtx = vi.fn<(locals: LoadCtx) => Promise<CoreCtx | null>>();
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (locals: LoadCtx) => mockGetCoreCtx(locals),
}));

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
    const { db, resolve } = createMockDb();
    resolve([{ id: 'prof-1' }]); // resolveProfileId → profile
    await updatePersonalAgent(ctx(db), 'user-1', { avatarUrl: 'https://example.com/a.png' });
    expect(db.update).toHaveBeenCalled();
  });
});

describe('updateProvisioningStatus', () => {
  it('transitions pending -> provisioning', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'prof-1' }]); // resolveProfileId → profile
    await updateProvisioningStatus(ctx(db), 'user-1', 'provisioning');
    expect(db.update).toHaveBeenCalled();
  });

  it('transitions provisioning -> active', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'prof-1' }]); // resolveProfileId → profile
    await updateProvisioningStatus(ctx(db), 'user-1', 'active');
    expect(db.update).toHaveBeenCalled();
  });

  it('transitions provisioning -> error with error message', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'prof-1' }]); // resolveProfileId → profile
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
    // Post-GoTrue: rows are plain personalAgents rows; echoed userId = profileId.
    resolve([
      pgRow({ id: 'pa-1', provisioningStatus: 'pending', profileId: 'prof-1' }),
      pgRow({ id: 'pa-2', provisioningStatus: 'error', retryCount: 2, profileId: 'prof-2' }),
    ]);
    const result = await listPendingAgents(ctx(db));
    expect(result.map((r) => r.userId)).toEqual(['prof-1', 'prof-2']);
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
    const { db, resolve } = createMockDb();
    resolve([{ id: 'prof-1' }]); // resolveProfileId → profile
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

describe('loadPersonalAgentForUser', () => {
  const locals = {} as LoadCtx;

  it('rejects with 401 and never reaches getPersonalAgent when getCoreCtx resolves no tenant context', async () => {
    mockGetCoreCtx.mockResolvedValue(null);

    // A real getPersonalAgent call against a null ctx would throw a TypeError
    // (reading `.db` off null), not an HttpError shaped { status: 401 }. Getting
    // exactly the 401 shape below is only possible via the `if (!ctx) throw ...`
    // guard firing first, so this doubles as "delegate not called" evidence —
    // getPersonalAgent can't be spied on directly (see note in the happy-path
    // case below on same-module call interception).
    await expect(loadPersonalAgentForUser(locals, 'user-1')).rejects.toMatchObject({
      status: 401,
    });
    expect(mockGetCoreCtx).toHaveBeenCalledTimes(1);
    expect(mockGetCoreCtx).toHaveBeenCalledWith(locals);
  });

  it('delegates to getPersonalAgent(ctx, userId, supabaseId) and returns its result as { agent }', async () => {
    // Vitest/vite-node here does not rewrite intra-module references, so
    // vi.spyOn on this module's own getPersonalAgent export does not intercept
    // the internal call made from inside loadPersonalAgentForUser (verified
    // empirically — the call bypasses the spied binding entirely). Delegation
    // is instead observed through the real getPersonalAgent's DB behavior:
    // a distinctive row from the mocked db, echoed straight through.
    const { db, resolve } = createMockDb();
    resolve([
      pgRow({
        id: 'entrypoint-sentinel-id',
        agentId: 'entrypoint-sentinel-agent',
        displayName: 'Entrypoint Sentinel',
        provisioningStatus: 'active',
      }),
    ]);
    const resolvedCtx = ctx(db);
    mockGetCoreCtx.mockResolvedValue(resolvedCtx as never);

    const result = await loadPersonalAgentForUser(locals, 'entrypoint-user', 'entrypoint-profile-1');

    expect(result).toEqual({
      agent: {
        id: 'entrypoint-sentinel-id',
        userId: 'entrypoint-user', // echoed by reshape() — proves userId reached the delegate
        agentId: 'entrypoint-sentinel-agent',
        serverId: 'srv-1',
        displayName: 'Entrypoint Sentinel',
        conversationName: null,
        avatarUrl: null,
        personalityPreset: null,
        personalityText: null,
        personalityConfigured: false,
        provisioningStatus: 'active',
        provisioningError: null,
        lastRetryAt: null,
        retryCount: 0,
        createdAt: TS.getTime(),
        updatedAt: TS.getTime(),
      },
    });
    expect(mockGetCoreCtx).toHaveBeenCalledTimes(1);
    expect(mockGetCoreCtx).toHaveBeenCalledWith(locals);
    // resolveProfileId(ctx, userId, supabaseId) short-circuits on a truthy
    // supabaseId (returns it directly, no profiles lookup). Exactly one
    // db.select — the personalAgents query — proves supabaseId reached the
    // delegate: if it were dropped, a second select (profiles lookup by
    // userId) would fire first.
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
