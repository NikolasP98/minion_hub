import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listUsers, createUser, updateUserRole, deleteUser } from './user.service';
import { createMockDb } from '$server/test-utils/mock-db';
import { user } from '$server/db/schema';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-user-id-000000001',
  nowMs: () => 1_700_000_000_000,
}));

const mockSignUpEmail = vi.fn().mockResolvedValue({ user: { id: 'auth-user-id-001' } });
vi.mock('$lib/auth/auth', () => ({
  getAuth: () => ({
    api: {
      signUpEmail: mockSignUpEmail,
    },
  }),
}));

describe('listUsers', () => {
  it('calls db.select and returns results', async () => {
    const { db, resolve } = createMockDb();
    const mockUsers = [
      { id: 'u1', email: 'a@b.com', displayName: 'A', role: 'admin', createdAt: null },
    ];
    resolve(mockUsers);
    const result = await listUsers({ db, tenantId: 't1' });
    expect(result).toEqual(mockUsers);
  });
});

describe('createUser', () => {
  it('calls auth.api.signUpEmail and returns user id', async () => {
    const { db } = createMockDb();
    const id = await createUser(
      { db, tenantId: 't1' },
      { email: 'new@test.com', password: 'secret123' },
    );
    expect(mockSignUpEmail).toHaveBeenCalledTimes(1);
    expect(id).toBe('auth-user-id-001');
  });

  it('updates role when role is admin', async () => {
    const { db } = createMockDb();
    await createUser(
      { db, tenantId: 't1' },
      { email: 'admin@test.com', password: 'secret123', role: 'admin' },
    );
    expect(db.update).toHaveBeenCalledWith(user);
  });
});

describe('updateUserRole', () => {
  it('calls db.update on user table', async () => {
    const { db } = createMockDb();
    await updateUserRole({ db, tenantId: 't1' }, 'u1', 'admin');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(user);
  });
});

describe('deleteUser', () => {
  it('calls db.delete on user table', async () => {
    const { db } = createMockDb();
    await deleteUser({ db, tenantId: 't1' }, 'u1');
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(user);
  });
});
