import { describe, expect, it } from 'vitest';
import type { CoreTx } from '$server/db/with-org-core';
import {
  assertActiveOperatorPrincipalReadOnlyInTx,
  OperatorAuthorityError,
  readOperatorAuthorityForWriteInTx,
  readOperatorAuthorityReadOnlyInTx,
  validateOperatorAuthorityRows,
} from './active-operator-principal';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);

function good(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    orgId: ORG,
    profileId: PROFILE,
    organizationStatus: 'active',
    deletionPending: false,
    roleModel: 'legacy',
    defaultRoleKey: null,
    membershipRole: 'member',
    assignedRoleKeys: ['staff'],
    localRoleKeys: [],
    rules: [],
    authorityRows: [{ table: 'profiles', key: [PROFILE], rowHash: HASH }],
    ...over,
  };
}

/** Scripted tx: first execute = scope state, second = bridge call. */
function fakeTx(opts: { role?: string; org?: string; profile?: string; bridge?: unknown | Error }) {
  const calls: unknown[] = [];
  let n = 0;
  const tx = {
    async execute(query: unknown) {
      calls.push(query);
      if (n++ === 0)
        return [
          {
            role: opts.role ?? 'app_ledger',
            org: opts.org ?? ORG,
            profile: opts.profile ?? PROFILE,
          },
        ];
      if (opts.bridge instanceof Error) throw opts.bridge;
      return [{ authority: opts.bridge ?? good() }];
    },
  } as unknown as CoreTx;
  return { tx, calls };
}

describe('operator authority bridge adapters', () => {
  it('returns validated rows for both modes', async () => {
    expect(
      (await readOperatorAuthorityReadOnlyInTx(fakeTx({}).tx, ORG, PROFILE)).membershipRole,
    ).toBe('member');
    expect(
      (await readOperatorAuthorityForWriteInTx(fakeTx({}).tx, ORG, PROFILE)).assignedRoleKeys,
    ).toEqual(['staff']);
  });

  it.each([
    ['non app_ledger role', { role: 'postgres' }],
    ['org GUC mismatch', { org: '33333333-3333-4333-8333-333333333333' }],
    ['profile GUC missing', { profile: '' }],
  ])('refuses %s before calling the function', async (_n, opts) => {
    const { tx, calls } = fakeTx(opts);
    await expect(readOperatorAuthorityReadOnlyInTx(tx, ORG, PROFILE)).rejects.toMatchObject({
      code: 'operator_scope_invalid',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses non-canonical ids without touching the database', async () => {
    const { tx, calls } = fakeTx({});
    await expect(readOperatorAuthorityReadOnlyInTx(tx, 'nope', PROFILE)).rejects.toBeInstanceOf(
      OperatorAuthorityError,
    );
    expect(calls).toHaveLength(0);
  });

  it('maps SQL failures to typed codes and never to empty authority', async () => {
    await expect(
      readOperatorAuthorityReadOnlyInTx(
        fakeTx({ bridge: new Error('operator_principal_inactive') }).tx,
        ORG,
        PROFILE,
      ),
    ).rejects.toMatchObject({ code: 'operator_principal_inactive' });
    await expect(
      readOperatorAuthorityReadOnlyInTx(
        fakeTx({ bridge: new Error('function does not exist') }).tx,
        ORG,
        PROFILE,
      ),
    ).rejects.toMatchObject({ code: 'operator_authority_unavailable' });
  });

  it.each([
    ['extra key', good({ extra: 1 })],
    ['wrong org', good({ orgId: PROFILE })],
    ['inactive org', good({ organizationStatus: 'deleted' })],
    ['bad hash', good({ authorityRows: [{ table: 'profiles', key: [PROFILE], rowHash: 'x' }] })],
    [
      'unknown table',
      good({ authorityRows: [{ table: 'auth_users', key: [PROFILE], rowHash: HASH }] }),
    ],
    [
      'too many assigned',
      good({ assignedRoleKeys: Array.from({ length: 129 }, (_, i) => `r${i}`) }),
    ],
    ['null', null],
  ])('rejects a malformed projection: %s', (_n, value) => {
    expect(() => validateOperatorAuthorityRows(value, ORG, PROFILE)).toThrow(
      OperatorAuthorityError,
    );
  });

  it('hashes the selected state stably and changes when an authority row changes', async () => {
    const a = await assertActiveOperatorPrincipalReadOnlyInTx(fakeTx({}).tx, ORG, PROFILE);
    const b = await assertActiveOperatorPrincipalReadOnlyInTx(fakeTx({}).tx, ORG, PROFILE);
    const c = await assertActiveOperatorPrincipalReadOnlyInTx(
      fakeTx({
        bridge: good({
          authorityRows: [{ table: 'profiles', key: [PROFILE], rowHash: 'b'.repeat(64) }],
        }),
      }).tx,
      ORG,
      PROFILE,
    );
    expect(a.principalStateHash).toBe(b.principalStateHash);
    expect(a.principalStateHash).not.toBe(c.principalStateHash);
  });
});
