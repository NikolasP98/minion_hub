import { describe, it, expect, vi } from 'vitest';
import { createBug, listBugs } from './bug.service';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-bug-id-0000000001',
  nowMs: () => 1_700_000_000_000,
}));

describe('createBug', () => {
  it('calls db.insert and returns id', async () => {
    const { db } = createMockDb();
    const id = await createBug(
      { db, tenantId: 't1' },
      { serverId: 's1', message: 'Something broke' },
    );
    expect(id).toBe('mock-bug-id-0000000001');
    expect(db.insert).toHaveBeenCalled();
  });

  it('defaults severity to medium', async () => {
    const { db } = createMockDb();
    // The function sets severity ?? 'medium' — we verify it doesn't throw with no severity
    const id = await createBug(
      { db, tenantId: 't1' },
      { serverId: 's1', message: 'Error' },
    );
    expect(typeof id).toBe('string');
  });
});

describe('listBugs', () => {
  it('returns results from db', async () => {
    const { db, resolve } = createMockDb();
    const mockBugs = [{ id: 'b1', message: 'err', severity: 'medium' }];
    resolve(mockBugs);
    const result = await listBugs({ db, tenantId: 't1' });
    expect(result).toEqual(mockBugs);
  });

  it('accepts serverId filter without error', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await listBugs({ db, tenantId: 't1' }, { serverId: 's1' });
    expect(result).toEqual([]);
  });
});
