import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listUsers, createUser, updateUserRole, deleteUser } from './user.service';
import { createMockDb } from '$server/test-utils/mock-db';
// Import the same `user` table object the service uses (hub-local schema), so
// toHaveBeenCalledWith(user) compares by identity rather than against the
// canonical @minion-stack/db table (a different instance).
import { user } from '../db/schema/auth';

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

// deleteUser also removes the org membership via the Supabase admin client.
// Stub it so the unit test stays hermetic (the real client needs SUPABASE_URL +
// service-role key, and createClient throws without them).
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({ delete: () => ({ match: () => Promise.resolve({ error: null }) }) }),
  }),
}));

describe('listUsers', () => {
  it('calls db.select and returns results with organizations', async () => {
    const { db, resolveSequence } = createMockDb();
    const mockUsers = [
      { id: 'u1', email: 'a@b.com', displayName: 'A', role: 'admin', createdAt: null },
    ];
    resolveSequence([
      mockUsers,
      [], // no memberships for these users
    ]);
    const result = await listUsers({ db, tenantId: 't1' });
    expect(result).toEqual([
      { ...mockUsers[0], organizations: [] },
    ]);
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
