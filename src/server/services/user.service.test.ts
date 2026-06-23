import { describe, it, expect, vi, beforeEach } from 'vitest';

// The user-admin service is now Supabase-keyed (profiles + organization_members);
// the legacy Turso `db` is gone. Mock the admin client with a chain recorder so
// each call resolves through a per-test resolver.

const authAdmin = {
  createUser: vi.fn(async () => ({ data: { user: { id: 'auth-new-001' } }, error: null })),
  deleteUser: vi.fn(async () => ({ error: null })),
  updateUserById: vi.fn(async () => ({ error: null })),
};

// resolve(table, methods) -> { data, error }. methods is the recorded chain,
// e.g. [['select','profile_id'],['eq','organization_id','t1']].
let resolver: (table: string, methods: unknown[][]) => { data: unknown; error: unknown };

function makeAdmin() {
  function from(table: string) {
    const methods: unknown[][] = [];
    const handler: ProxyHandler<object> = {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(resolver(table, methods)).then(res, rej);
        }
        if (prop === 'maybeSingle') {
          return () => Promise.resolve(resolver(table, [...methods, ['maybeSingle']]));
        }
        return (...args: unknown[]) => {
          methods.push([prop, ...args]);
          return proxy;
        };
      },
    };
    const proxy: Record<string, unknown> = new Proxy({}, handler);
    return proxy;
  }
  return { from, auth: { admin: authAdmin } };
}

vi.mock('$server/supabase', () => ({ supabaseAdmin: () => makeAdmin() }));

import { listUsers, createUser, updateUserRole, deleteUser } from './user.service';

beforeEach(() => {
  vi.clearAllMocks();
  resolver = () => ({ data: [], error: null });
});

describe('listUsers', () => {
  it('returns the active org members with their organizations', async () => {
    resolver = (table, methods) => {
      if (table === 'organization_members') {
        // The per-user membership read selects organizations(...); the org-scope
        // read selects only profile_id.
        const selectsOrgs = methods.some(
          (m) => m[0] === 'select' && String(m[1]).includes('organizations'),
        );
        if (selectsOrgs) {
          return {
            data: [{ profile_id: 'u1', role: 'member', organizations: { id: 't1', name: 'Acme' } }],
            error: null,
          };
        }
        return { data: [{ profile_id: 'u1' }], error: null };
      }
      if (table === 'profiles') {
        return {
          data: [
            {
              id: 'u1',
              email: 'a@b.com',
              display_name: 'A',
              role: 'admin',
              alias: null,
              role_id: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };

    const result = await listUsers({ tenantId: 't1' });
    expect(result).toEqual([
      {
        id: 'u1',
        email: 'a@b.com',
        displayName: 'A',
        role: 'admin',
        accountType: 'person',
        alias: null,
        roleId: null,
        createdAt: '2026-01-01T00:00:00Z',
        organizations: [{ id: 't1', name: 'Acme', role: 'member' }],
      },
    ]);
  });

  it('returns [] when the org has no members', async () => {
    resolver = () => ({ data: [], error: null });
    const result = await listUsers({ tenantId: 't1' });
    expect(result).toEqual([]);
  });
});

describe('createUser', () => {
  it('provisions the Supabase auth identity and returns its id', async () => {
    const id = await createUser(
      { db: {} as never, tenantId: 't1' },
      { email: 'new@test.com', password: 'secret123' },
    );
    expect(authAdmin.createUser).toHaveBeenCalledTimes(1);
    expect(id).toBe('auth-new-001');
  });
});

describe('updateUserRole', () => {
  it('updates the profile role', async () => {
    let updated: unknown[][] | null = null;
    resolver = (table, methods) => {
      if (table === 'profiles') updated = methods;
      return { data: [], error: null };
    };
    await updateUserRole({ db: {} as never, tenantId: 't1' }, 'u1', 'admin');
    expect(updated).not.toBeNull();
    expect(updated!.some((m) => m[0] === 'update')).toBe(true);
    expect(updated!.some((m) => m[0] === 'eq' && m[1] === 'id' && m[2] === 'u1')).toBe(true);
  });
});

describe('deleteUser', () => {
  it('revokes memberships and deletes the auth identity (the real revocation)', async () => {
    await deleteUser({ db: {} as never, tenantId: 't1' }, '12a127af-cf23-4a59-b52a-9476de161a3b');
    expect(authAdmin.deleteUser).toHaveBeenCalledWith('12a127af-cf23-4a59-b52a-9476de161a3b');
  });

  it('refuses a non-uuid id (stray legacy Turso id) without calling auth admin', async () => {
    await deleteUser({ db: {} as never, tenantId: 't1' }, 'Nk7uYyAfRBL4nGDrTBfmzNVNK17Xvwk0');
    expect(authAdmin.deleteUser).not.toHaveBeenCalled();
  });
});
