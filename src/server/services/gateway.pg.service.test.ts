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
  },
  userGateway: { profileId: 'profileId', gatewayId: 'gatewayId', isDefault: 'isDefault' },
}));

// ── mock drizzle-orm (eq, and) ───────────────────────────────────────────────
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default chain for insert().values().returning()
  insertReturning.mockResolvedValue([{ id: 'g1' }]);
  // Default chain for select().from()...
  selectFrom.mockReturnValue({
    orderBy: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
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
    const g = await createGateway({ name: 'prod', url: 'ws://gw', token: 'secret', profileId: 'p1' });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tokenCiphertext: 'enc:secret', tokenIv: 'iv1' }),
    );
    expect(g.id).toBe('g1');
  });

  test('getUserGatewayCredentials returns decrypted token', async () => {
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { url: 'ws://gw', tokenCiphertext: 'enc:secret', tokenIv: 'iv1' },
          ]),
        }),
      }),
    });
    const cred = await getUserGatewayCredentials('p1');
    expect(cred?.url).toBe('ws://gw');
    expect(cred?.token).toBe('secret');
  });

  test('getUserGatewayCredentials returns plaintext token without decrypt when token_iv empty', async () => {
    const crypto = await import('$server/auth/crypto');
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { url: 'ws://gw', tokenCiphertext: 'rawtoken', tokenIv: '' },
          ]),
        }),
      }),
    });
    const cred = await getUserGatewayCredentials('p1');
    expect(cred?.token).toBe('rawtoken');
    // Real openSecret throws ERR_CRYPTO_INVALID_IV on an empty iv — the plaintext
    // row must bypass decrypt entirely (regression guard for the token-mismatch bug).
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  test('getUserGatewayCredentials returns null when no rows', async () => {
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    // Default mock returns []
    const cred = await getUserGatewayCredentials('p1');
    expect(cred).toBeNull();
  });

  test('getSystemGatewayCredentials picks preferredUrl and decrypts', async () => {
    const { getSystemGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(
      Promise.resolve([
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
      Promise.resolve([{ url: 'ws://gw', tokenCiphertext: 'rawtoken', tokenIv: '' }]),
    );
    const cred = await getSystemGatewayCredentials();
    expect(cred?.token).toBe('rawtoken');
  });

  test('getSystemGatewayCredentials returns null when no gateways', async () => {
    const { getSystemGatewayCredentials } = await import('./gateway.pg.service');
    selectFrom.mockReturnValueOnce(Promise.resolve([]));
    const cred = await getSystemGatewayCredentials();
    expect(cred).toBeNull();
  });

  test('deleteGateway calls delete with eq', async () => {
    const { deleteGateway } = await import('./gateway.pg.service');
    await deleteGateway('g1');
    expect(mockDb.delete).toHaveBeenCalled();
  });
});
