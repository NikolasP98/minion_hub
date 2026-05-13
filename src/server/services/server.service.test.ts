import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertServer, listServers, deleteServer } from './server.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-server-id-00000001',
  nowMs: () => 1_700_000_000_000,
}));

describe('upsertServer', () => {
  it('calls db.insert and returns an id', async () => {
    const { db } = createMockDb();
    const id = await upsertServer(
      { db, tenantId: 't1' },
      { name: 'srv', url: 'http://localhost', token: 'tok' },
    );
    expect(id).toBe('mock-server-id-00000001');
    expect(db.insert).toHaveBeenCalled();
  });

  it('uses provided id when given', async () => {
    const { db } = createMockDb();
    const id = await upsertServer(
      { db, tenantId: 't1' },
      { id: 'existing-id', name: 'srv', url: 'http://localhost', token: 'tok' },
    );
    expect(id).toBe('existing-id');
  });
});

describe('listServers', () => {
  it('returns rows without token fields', async () => {
    const { db, resolve } = createMockDb();
    const mockServers = [
      { id: 's1', name: 'test', url: 'http://x', lastConnectedAt: null },
    ];
    resolve(mockServers);
    const result = await listServers({ db, tenantId: 't1' });
    expect(result).toEqual(mockServers);
    for (const row of result as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty('token');
      expect(row).not.toHaveProperty('tokenIv');
    }
  });
});

describe('deleteServer', () => {
  it('calls db.delete', async () => {
    const { db } = createMockDb();
    await deleteServer({ db, tenantId: 't1' }, 's1');
    expect(db.delete).toHaveBeenCalled();
  });
});
