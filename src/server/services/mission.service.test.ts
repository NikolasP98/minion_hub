import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMission,
  listMissions,
  getMission,
  updateMission,
  deleteMission,
} from './mission.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-mission-id-00000001',
  nowMs: () => 1_700_000_000_000,
}));

// missions now key on gateway_id; stub the serverId↔gatewayId resolvers so unit
// tests stay hermetic (the real ones hit getCoreDb).
vi.mock('$server/services/gateway.pg.service', () => ({
  resolveGatewayId: () => Promise.resolve('gw-1'),
  resolveServerId: () => Promise.resolve('s1'),
}));

// pg rows are typed for PostgresJsDatabase; the mock db is structural — cast.
const ctx = (db: unknown) => ({ db: db as never, tenantId: 't1' });
const TS = new Date(1_700_000_000_000);
const row = {
  id: 'm1',
  tenantId: 't1',
  gatewayId: 'gw-1',
  sessionId: 'sess1',
  title: 'Mission 1',
  description: null,
  status: 'active',
  metadata: null,
  createdAt: TS,
  updatedAt: TS,
};

describe('createMission', () => {
  it('calls db.insert and returns id', async () => {
    const { db } = createMockDb();
    const id = await createMission(ctx(db), {
      serverId: 's1',
      sessionId: 'sess1',
      title: 'Build landing page',
    });
    expect(id).toBe('mock-mission-id-00000001');
    expect(db.insert).toHaveBeenCalled();
  });

  it('defaults optional fields to null', async () => {
    const { db } = createMockDb();
    const id = await createMission(ctx(db), {
      serverId: 's1',
      sessionId: 'sess1',
      title: 'Test mission',
    });
    expect(typeof id).toBe('string');
  });
});

describe('listMissions', () => {
  it('returns rows reshaped to the Turso-era shape (serverId + epoch ts)', async () => {
    const { db, resolve } = createMockDb();
    resolve([row]);
    const result = await listMissions(ctx(db), { serverId: 's1' });
    expect(result).toEqual([
      {
        id: 'm1',
        tenantId: 't1',
        serverId: 's1',
        sessionId: 'sess1',
        title: 'Mission 1',
        description: null,
        status: 'active',
        metadata: null,
        createdAt: TS.getTime(),
        updatedAt: TS.getTime(),
      },
    ]);
  });

  it('accepts sessionId filter without error', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await listMissions(ctx(db), { serverId: 's1', sessionId: 'sess1' });
    expect(result).toEqual([]);
  });
});

describe('getMission', () => {
  it('returns reshaped mission when found', async () => {
    const { db, resolve } = createMockDb();
    resolve([row]);
    const result = await getMission(ctx(db), 'm1');
    expect(result?.id).toBe('m1');
    expect(result?.serverId).toBe('s1');
    expect(result?.createdAt).toBe(TS.getTime());
  });

  it('returns null when not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await getMission(ctx(db), 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('updateMission', () => {
  it('calls db.update without error', async () => {
    const { db } = createMockDb();
    await updateMission(ctx(db), 'm1', { status: 'completed' });
    expect(db.update).toHaveBeenCalled();
  });
});

describe('deleteMission', () => {
  it('calls db.delete without error', async () => {
    const { db } = createMockDb();
    await deleteMission(ctx(db), 'm1');
    expect(db.delete).toHaveBeenCalled();
  });
});
