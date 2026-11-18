import { describe, expect, it, vi } from 'vitest';
import {
  assertOperatorNativeAuthFixture,
  installOperatorNativeAuthFixture,
  type OwnedChildIdentity,
} from './operator-native-auth-fixture';

const id: OwnedChildIdentity = {
  name: `minion_qc_faces_audit_${'a'.repeat(32)}`,
  marker: 'minion-360-disposable:v1',
  prefix: 'audit',
};

describe('operator native auth fixture guards', () => {
  it('refuses a controller or shared database before any DDL', async () => {
    const unsafe = vi.fn();
    await expect(
      installOperatorNativeAuthFixture({ unsafe }, { ...id, name: 'minion_qc_vectors' }),
    ).rejects.toThrow(/owned feature child/);
    expect(unsafe).not.toHaveBeenCalled();
  });

  it('refuses a child whose recorded identity does not match the connection', async () => {
    const unsafe = vi.fn(async () => [{ db: 'other', marker: id.marker, super: true }]);
    await expect(assertOperatorNativeAuthFixture({ unsafe }, id)).rejects.toThrow(
      /qualified owned child/,
    );
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-inert pre-existing sentinel role', async () => {
    const unsafe = vi.fn(async (q: string) =>
      q.includes('current_database()')
        ? [{ db: id.name, marker: id.marker, super: true }]
        : [
            {
              rolcanlogin: true,
              rolinherit: false,
              rolsuper: false,
              rolbypassrls: false,
              edges: false,
            },
          ],
    );
    await expect(installOperatorNativeAuthFixture({ unsafe }, id)).rejects.toThrow(/not inert/);
  });

  it.each([
    [
      'LOGIN',
      { rolcanlogin: true, rolinherit: false, rolsuper: false, rolbypassrls: false, edges: false },
    ],
    [
      'INHERIT',
      { rolcanlogin: false, rolinherit: true, rolsuper: false, rolbypassrls: false, edges: false },
    ],
    [
      'SUPERUSER',
      { rolcanlogin: false, rolinherit: false, rolsuper: true, rolbypassrls: false, edges: false },
    ],
    [
      'BYPASSRLS',
      { rolcanlogin: false, rolinherit: false, rolsuper: false, rolbypassrls: true, edges: false },
    ],
    [
      'membership edge',
      { rolcanlogin: false, rolinherit: false, rolsuper: false, rolbypassrls: false, edges: true },
    ],
  ])('refuses a pre-existing sentinel role with %s before any DDL', async (_name, attrs) => {
    const ddl: string[] = [];
    const unsafe = vi.fn(async (q: string) => {
      if (q.includes('current_database()'))
        return [{ db: id.name, marker: id.marker, super: true }];
      if (q.startsWith('CREATE') || q.startsWith('select 1')) ddl.push(q);
      return [attrs];
    });
    await expect(installOperatorNativeAuthFixture({ unsafe }, id)).rejects.toThrow(/not inert/);
    expect(ddl.filter((q) => q.startsWith('CREATE'))).toEqual([]);
  });

  it('creates every absent sentinel role inert and installs the auth schema last', async () => {
    const queries: string[] = [];
    const unsafe = vi.fn(async (q: string) => {
      queries.push(q);
      return q.includes('current_database()')
        ? [{ db: id.name, marker: id.marker, super: true }]
        : [];
    });
    await installOperatorNativeAuthFixture({ unsafe }, id);
    const roles = queries.filter((q) => q.startsWith('CREATE ROLE'));
    expect(roles.map((q) => q.split(' ')[2]).sort()).toEqual(
      [
        'app_assistant_ro',
        'brain_vector_worker',
        'dashboard_user',
        'postgres',
        'service_role',
        'supabase_auth_admin',
      ].sort(),
    );
    expect(roles.every((q) => q.endsWith('NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS'))).toBe(true);
    expect(queries[queries.length - 1]).toContain('CREATE SCHEMA auth');
  });
});
