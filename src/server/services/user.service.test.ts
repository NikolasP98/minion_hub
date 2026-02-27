import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listUsers, createContactUser, updateUserRole, removeUserFromTenant } from './user.service';
import { createMockDb } from '$server/test-utils/mock-db';
import { member } from '$server/db/schema';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-user-id-000000001',
  nowMs: () => 1_700_000_000_000,
}));

vi.mock('$lib/auth', () => ({
  auth: {
    api: {
      signUpEmail: vi.fn().mockResolvedValue({ user: { id: 'auth-user-id-001' } }),
    },
  },
}));

describe('listUsers', () => {
  it('calls db.select and returns results', async () => {
    const { db, resolve } = createMockDb();
    const mockUsers = [
      { id: 'u1', email: 'a@b.com', displayName: 'A', role: 'admin' },
    ];
    resolve(mockUsers);
    const result = await listUsers({ db, tenantId: 't1' });
    expect(result).toEqual(mockUsers);
  });
});

describe('createContactUser', () => {
  it('calls auth.api.signUpEmail and inserts member', async () => {
    const { auth } = await import('$lib/auth');
    const { db } = createMockDb();
    const id = await createContactUser(
      { db, tenantId: 't1' },
      { email: 'new@test.com', password: 'secret123' },
    );
    expect(auth.api.signUpEmail).toHaveBeenCalledTimes(1);
    expect(id).toBe('auth-user-id-001');
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith(member);
  });

  it('returns the user id from Better Auth', async () => {
    const { db } = createMockDb();
    const id = await createContactUser(
      { db, tenantId: 't1' },
      { email: 'x@y.com', password: 'secret123', displayName: 'X' },
    );
    expect(typeof id).toBe('string');
    expect(id).toBe('auth-user-id-001');
  });
});

describe('updateUserRole', () => {
  it('calls db.update on member table', async () => {
    const { db } = createMockDb();
    await updateUserRole({ db, tenantId: 't1' }, 'u1', 'admin');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(member);
  });
});

describe('removeUserFromTenant', () => {
  it('calls db.delete on member table', async () => {
    const { db } = createMockDb();
    await removeUserFromTenant({ db, tenantId: 't1' }, 'u1');
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(member);
  });
});
