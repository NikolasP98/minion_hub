import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }));

import { operatorDatabaseIdentity, verifyOperatorPrincipal } from './operator-principal';

const PROFILE = '22222222-2222-4222-8222-222222222222';
const target = { databaseIdentity: 'x', authProject: 'proj', authUrl: 'https://auth.example.org' };
const base = {
  accessToken: 't',
  authUrl: target.authUrl,
  anonKey: 'k',
  expectedProfileId: PROFILE,
  targetFingerprint: target,
};

describe('operatorDatabaseIdentity', () => {
  const url = 'postgresql://user:secret@DB.example.org:6543/hub?sslmode=require#x';
  it('is stable across credential rotation and ignores query/fragment', () => {
    expect(operatorDatabaseIdentity(url, 'p')).toBe(
      operatorDatabaseIdentity('postgres://other:rotated@db.example.org:6543/hub', 'p'),
    );
  });
  it.each([
    ['host', 'postgresql://u:p@other.example.org:6543/hub'],
    ['port', 'postgresql://u:p@db.example.org:5432/hub'],
    ['database', 'postgresql://u:p@db.example.org:6543/other'],
  ])('changes with %s', (_n, changed) => {
    expect(operatorDatabaseIdentity(changed, 'p')).not.toBe(operatorDatabaseIdentity(url, 'p'));
  });
  it('changes with authProject and defaults the port to 5432', () => {
    expect(operatorDatabaseIdentity(url, 'q')).not.toBe(operatorDatabaseIdentity(url, 'p'));
    expect(operatorDatabaseIdentity('postgres://a:b@h/db', 'p')).toBe(
      operatorDatabaseIdentity('postgres://a:b@h:5432/db', 'p'),
    );
  });
  it('rejects non-postgres, missing database and missing project', () => {
    expect(() => operatorDatabaseIdentity('https://h/db', 'p')).toThrow();
    expect(() => operatorDatabaseIdentity('postgres://h', 'p')).toThrow();
    expect(() => operatorDatabaseIdentity(url, '')).toThrow();
  });
});

describe('verifyOperatorPrincipal', () => {
  beforeEach(() => getUser.mockReset());

  it('binds the verified subject to the approved actor and target', async () => {
    getUser.mockResolvedValue({ data: { user: { id: PROFILE } }, error: null });
    await expect(verifyOperatorPrincipal(base)).resolves.toMatchObject({
      profileId: PROFILE,
      authProject: 'proj',
    });
  });
  it.each([
    [
      'rejected token',
      () =>
        getUser.mockResolvedValue({ data: { user: null }, error: new Error('jwt secret-token') }),
    ],
    ['no user returned', () => getUser.mockResolvedValue({ data: { user: null }, error: null })],
    [
      'other subject',
      () =>
        getUser.mockResolvedValue({
          data: { user: { id: '33333333-3333-4333-8333-333333333333' } },
          error: null,
        }),
    ],
  ])('refuses %s without leaking the token', async (_n, arrange) => {
    arrange();
    const error = await verifyOperatorPrincipal(base).catch((e) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('secret-token');
  });
  it.each([
    ['auth url differs from target', { authUrl: 'https://evil.example.org' }],
    [
      'plain http remote',
      {
        authUrl: 'http://auth.example.org',
        targetFingerprint: { ...target, authUrl: 'http://auth.example.org' },
      },
    ],
    ['non-uuid actor', { expectedProfileId: 'nope' }],
    ['missing token', { accessToken: '' }],
  ])('refuses %s before any network call', async (_n, over) => {
    await expect(verifyOperatorPrincipal({ ...base, ...over })).rejects.toThrow(/refused/);
    expect(getUser).not.toHaveBeenCalled();
  });
});
