import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMission, listMissions, getMission, updateMission, deleteMission } from './mission.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-mission-id-00000001',
  nowMs: () => 1_700_000_000_000,
}));

describe('createMission', () => {
  it('calls db.insert and returns id', async () => {
    const { db } = createMockDb();
    const id = await createMission(
      { db, tenantId: 't1' },
      { serverId: 's1', sessionId: 'sess1', title: 'Build landing page' },
    );
    expect(id).toBe('mock-mission-id-00000001');
    expect(db.insert).toHaveBeenCalled();
  });

  it('defaults optional fields to null', async () => {
    const { db } = createMockDb();
    const id = await createMission(
      { db, tenantId: 't1' },
      { serverId: 's1', sessionId: 'sess1', title: 'Test mission' },
    );
    expect(typeof id).toBe('string');
  });
});

describe('listMissions', () => {
  it('returns results from db', async () => {
    const { db, resolve } = createMockDb();
    const mockMissions = [{ id: 'm1', title: 'Mission 1', status: 'active' }];
    resolve(mockMissions);
    const result = await listMissions({ db, tenantId: 't1' }, { serverId: 's1' });
    expect(result).toEqual(mockMissions);
  });

  it('accepts sessionId filter without error', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await listMissions({ db, tenantId: 't1' }, { serverId: 's1', sessionId: 'sess1' });
    expect(result).toEqual([]);
  });
});

describe('getMission', () => {
  it('returns mission when found', async () => {
    const { db, resolve } = createMockDb();
    const mockMission = { id: 'm1', title: 'Mission 1' };
    resolve([mockMission]);
    const result = await getMission({ db, tenantId: 't1' }, 'm1');
    expect(result).toEqual(mockMission);
  });

  it('returns null when not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await getMission({ db, tenantId: 't1' }, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('updateMission', () => {
  it('calls db.update without error', async () => {
    const { db } = createMockDb();
    await updateMission({ db, tenantId: 't1' }, 'm1', { status: 'completed' });
    expect(db.update).toHaveBeenCalled();
  });
});

describe('deleteMission', () => {
  it('calls db.delete without error', async () => {
    const { db } = createMockDb();
    await deleteMission({ db, tenantId: 't1' }, 'm1');
    expect(db.delete).toHaveBeenCalled();
  });
});
