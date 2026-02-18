import { describe, it, expect, vi } from 'vitest';
import { listUsers, createContactUser } from './user.service';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-user-id-000000001',
  nowMs: () => 1_700_000_000_000,
}));

vi.mock('$server/auth/password', () => ({
  hashPassword: vi.fn(async () => '$argon2-mock-hash'),
}));

describe('listUsers', () => {
  it('calls db.select and returns results', async () => {
    const { db, resolve } = createMockDb();
    const mockUsers = [
      { id: 'u1', email: 'a@b.com', displayName: 'A', kind: 'operator', role: 'admin' },
    ];
    resolve(mockUsers);
    const result = await listUsers({ db, tenantId: 't1' });
    expect(result).toEqual(mockUsers);
  });
});

describe('createContactUser', () => {
  it('calls db.insert twice (user + userTenants)', async () => {
    const { db } = createMockDb();
    const id = await createContactUser(
      { db, tenantId: 't1' },
      { email: 'new@test.com', password: 'secret123' },
    );
    expect(id).toBe('mock-user-id-000000001');
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('returns the generated user id', async () => {
    const { db } = createMockDb();
    const id = await createContactUser(
      { db, tenantId: 't1' },
      { email: 'x@y.com', displayName: 'X', password: 'pw' },
    );
    expect(typeof id).toBe('string');
    expect(id).toBe('mock-user-id-000000001');
  });
});
