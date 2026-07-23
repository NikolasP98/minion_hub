import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── mock getCoreDb ──────────────────────────────────────────────────────────
const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning, onConflictDoNothing: vi.fn() }));
const selectFrom = vi.fn();
const selectObj = vi.fn(() => ({ from: selectFrom }));
const deleteWhere = vi.fn();

const mockDb = {
  insert: vi.fn(() => ({ values: insertValues })),
  select: selectObj,
  delete: vi.fn(() => ({ where: deleteWhere })),
};

vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => mockDb }));

// ── mock crypto ─────────────────────────────────────────────────────────────
vi.mock('$server/auth/crypto', () => ({
  encrypt: vi.fn((t: string) => ({ ciphertext: `enc:${t}`, iv: 'iv1' })),
  decrypt: vi.fn((c: string, _iv: string) => c.replace('enc:', '')),
}));

// ── mock @minion-stack/db/pg ────────────────────────────────────────────────
vi.mock('@minion-stack/db/pg', () => ({
  gateway: {
    id: 'id',
    name: 'name',
    url: 'url',
    authMode: 'authMode',
    createdAt: 'createdAt',
    tokenCiphertext: 'tokenCiphertext',
    tokenIv: 'tokenIv',
    orgId: 'orgId',
  },
  userGateway: { profileId: 'profileId', gatewayId: 'gatewayId', isDefault: 'isDefault' },
}));

// ── mock drizzle-orm (eq, and, or, sql, desc) ────────────────────────────────
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  or: vi.fn((...args: unknown[]) => ({ _or: args })),
  sql: vi.fn(() => ({ _sql: true })),
  desc: vi.fn((col: unknown) => ({ _desc: col })),
}));

/** `select().from(gateway).orderBy(...)` — the system-credential read. It is
 *  ORDERED now (channel → created_at → id); an unordered heap scan let an
 *  unattended cron pick the DEV gateway. */
const systemOrderBy = vi.fn();
function systemRows(rows: unknown[]) {
  systemOrderBy.mockResolvedValue(rows);
  return { orderBy: systemOrderBy };
}

/** `…innerJoin().where().orderBy().limit()` — the per-user read, with the
 *  orderBy args captured so the TOTAL order can be asserted. */
const userOrderBy = vi.fn();
function userRows(rows: unknown[]) {
  userOrderBy.mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) });
  return {
    innerJoin: vi
      .fn()
      .mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: userOrderBy }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default chain for insert().values().returning()
  insertReturning.mockResolvedValue([{ id: 'g1' }]);
  // Default chain for select().from()...
  selectFrom.mockReturnValue({
    orderBy: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        // getUserGatewayCredentials orders before limiting (deterministic gateway pick)
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
    where: vi.fn().mockResolvedValue([]),
  });
  deleteWhere.mockResolvedValue(undefined);
});

describe('gateway.pg.service', () => {
  test('createGateway seals token and inserts via Drizzle, returns id', async () => {
    const { createGateway } = await import('./gateway.pg.service');
    const g = await createGateway({
      name: 'prod',
      url: 'ws://gw',
      token: 'secret',
      profileId: 'p1',
      orgId: 'org-1',
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenCiphertext: 'enc:secret',
        tokenIv: 'iv1',
        orgId: 'org-1',
      }),
    );
    expect(g.id).toBe('g1');
  });

  test('getUserGatewayCredentials returns decrypted token', async () => {
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { url: 'ws://gw', tokenCiphertext: 'enc:secret', tokenIv: 'iv1' },
              ]),
          }),
        }),
      }),
    });
    const cred = await getUserGatewayCredentials('p1', 'org-1');
    expect(cred?.url).toBe('ws://gw');
    expect(cred?.token).toBe('secret');
  });

  test('getUserGatewayCredentials returns plaintext token without decrypt when token_iv empty', async () => {
    const crypto = await import('$server/auth/crypto');
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([{ url: 'ws://gw', tokenCiphertext: 'rawtoken', tokenIv: '' }]),
          }),
        }),
      }),
    });
    const cred = await getUserGatewayCredentials('p1', 'org-1');
    expect(cred?.token).toBe('rawtoken');
    // Real openSecret throws ERR_CRYPTO_INVALID_IV on an empty iv — the plaintext
    // row must bypass decrypt entirely (regression guard for the token-mismatch bug).
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  test('getUserGatewayCredentials returns null when no rows', async () => {
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    // Default mock returns []
    const cred = await getUserGatewayCredentials('p1', 'org-1');
    expect(cred).toBeNull();
  });

  test('getGatewayTokenByServerId reads the token only inside the active org', async () => {
    const tokenWhere = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ tokenCiphertext: 'enc:secret', tokenIv: 'iv1' }]),
    });
    selectFrom
      .mockReturnValueOnce({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'gateway-scoped' }]),
        }),
      })
      .mockReturnValueOnce({ where: tokenWhere });
    const { and, eq } = await import('drizzle-orm');
    const { getGatewayTokenByServerId } = await import('./gateway.pg.service');

    const token = await getGatewayTokenByServerId('legacy-scoped', 'org-active');

    expect(token).toBe('secret');
    expect(vi.mocked(eq)).toHaveBeenCalledWith('orgId', 'org-active');
    expect(vi.mocked(and)).toHaveBeenCalledWith(
      { _eq: ['id', 'gateway-scoped'] },
      { _eq: ['orgId', 'org-active'] },
    );
  });

  test('getSystemGatewayCredentials picks preferredUrl and decrypts', async () => {
    const { getSystemGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(
      systemRows([
        { url: 'ws://other', tokenCiphertext: 'enc:nope', tokenIv: 'iv1' },
        { url: 'ws://primary', tokenCiphertext: 'enc:secret', tokenIv: 'iv1' },
      ]),
    );
    const cred = await getSystemGatewayCredentials('ws://primary');
    expect(cred?.url).toBe('ws://primary');
    expect(cred?.token).toBe('secret');
  });

  test('getSystemGatewayCredentials returns plaintext token when token_iv empty', async () => {
    const { getSystemGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(
      systemRows([{ url: 'ws://gw', tokenCiphertext: 'rawtoken', tokenIv: '' }]),
    );
    const cred = await getSystemGatewayCredentials();
    expect(cred?.token).toBe('rawtoken');
  });

  test('getSystemGatewayCredentials returns null when no gateways', async () => {
    const { getSystemGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(systemRows([]));
    const cred = await getSystemGatewayCredentials();
    expect(cred).toBeNull();
  });

  /**
   * Regression: the fallback per-user pick was `order by created_at desc` and
   * nothing else. `user_gateway` links every user to every row and the DEV rows
   * are the NEWEST, so that ordering handed the fallback a DEV gateway; and two
   * rows inserted in one transaction share a `created_at`, so even within a
   * channel the winner fell to Postgres heap order. The order must be TOTAL:
   * preferred channel → created_at → id.
   */
  test('getUserGatewayCredentials orders channel-first, then created_at, then id', async () => {
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(
      userRows([{ url: 'ws://gw', tokenCiphertext: 'enc:secret', tokenIv: 'iv1' }]),
    );
    await getUserGatewayCredentials('p1', 'org-1');
    const args = userOrderBy.mock.calls[0];
    expect(args).toHaveLength(3);
    expect(args[0]).toEqual({ _sql: true }); // channelFirst(channel)
    expect(args[1]).toEqual({ _desc: 'createdAt' });
    expect(args[2]).toBe('id'); // the tiebreak that makes it total
  });

  test('getUserGatewayCredentials defaults to the prd channel, never dev', async () => {
    const { sql } = await import('drizzle-orm');
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(
      userRows([{ url: 'ws://gw', tokenCiphertext: 'enc:secret', tokenIv: 'iv1' }]),
    );
    await getUserGatewayCredentials('p1', 'org-1');
    // channelFirst() interpolates the preferred channel into the template.
    expect(vi.mocked(sql).mock.calls.flat(2)).toContain('prd');
    expect(vi.mocked(sql).mock.calls.flat(2)).not.toContain('dev');
  });

  test('getUserGatewayCredentials scopes the linked gateway to the active org', async () => {
    const { and, eq } = await import('drizzle-orm');
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(
      userRows([{ url: 'ws://gw', tokenCiphertext: 'enc:secret', tokenIv: 'iv1' }]),
    );

    await getUserGatewayCredentials('p1', 'org-active');

    expect(vi.mocked(eq)).toHaveBeenCalledWith('profileId', 'p1');
    expect(vi.mocked(eq)).toHaveBeenCalledWith('orgId', 'org-active');
    expect(vi.mocked(and)).toHaveBeenCalledWith(
      { _eq: ['profileId', 'p1'] },
      { _eq: ['orgId', 'org-active'] },
    );
  });

  test('getSystemGatewayCredentials orders instead of trusting heap order', async () => {
    const { getSystemGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(systemRows([]));
    await getSystemGatewayCredentials();
    expect(systemOrderBy.mock.calls[0]).toEqual([{ _sql: true }, 'createdAt', 'id']);
  });

  test('deleteGateway calls delete with eq', async () => {
    const { deleteGateway } = await import('./gateway.pg.service');
    await deleteGateway('g1');
    expect(mockDb.delete).toHaveBeenCalled();
  });
});
