import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCanonicalProfile: vi.fn(),
  hasCanonicalMembership: vi.fn(),
  listActiveGatewaySigningKeys: vi.fn(),
  listGatewayPublicJwks: vi.fn(),
  insertGatewaySigningKey: vi.fn(),
  openSecret: vi.fn(),
  sealSecret: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({
  env: {
    BETTER_AUTH_URL: 'https://hub.example.test',
    GATEWAY_JWT_INCLUDE_LEGACY_JWKS: 'false',
  },
}));

vi.mock('./canonical-directory.service', () => ({
  loadCanonicalProfile: mocks.loadCanonicalProfile,
  hasCanonicalMembership: mocks.hasCanonicalMembership,
}));

vi.mock('./gateway-signing-key.repository', () => ({
  listActiveGatewaySigningKeys: mocks.listActiveGatewaySigningKeys,
  listGatewayPublicJwks: mocks.listGatewayPublicJwks,
  insertGatewaySigningKey: mocks.insertGatewaySigningKey,
}));

vi.mock('@minion-stack/db/pg', () => ({
  openSecret: mocks.openSecret,
  sealSecret: mocks.sealSecret,
}));

describe('gateway JWT issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasCanonicalMembership.mockResolvedValue(true);
  });

  test('reads identity and signing material without depending on PostgREST', async () => {
    const { exportJWK, generateKeyPair, jwtVerify } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    mocks.openSecret.mockReturnValue(JSON.stringify(privateJwk));
    mocks.loadCanonicalProfile.mockResolvedValue({
      id: '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6',
      email: 'user@example.test',
      display_name: 'User',
      role: 'admin',
      avatar_url: null,
      created_at: null,
      username: null,
    });
    mocks.listActiveGatewaySigningKeys.mockResolvedValue([
      {
        kid: 'kid-1',
        alg: 'EdDSA',
        public_jwk: { kid: 'kid-1', kty: 'OKP' },
        private_ciphertext: 'ciphertext',
        private_iv: 'iv',
      },
    ]);
    const { createClient } = await import('@libsql/client');
    const { drizzle } = await import('drizzle-orm/libsql');
    const sqlite = createClient({ url: 'file::memory:' });
    await sqlite.executeMultiple(`
      create table servers (id text primary key, tenant_id text not null);
      create table user_agents (user_id text, agent_id text, server_id text);
      insert into servers values ('server-a','org-a'),('server-a2','org-a'),('server-b','org-b');
      insert into user_agents values
        ('3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6','agent-a','server-a'),
        ('3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6','agent-a','server-a2'),
        ('3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6','agent-b','server-b'),
        ('other-user','agent-other','server-a');
    `);
    const ctx = { tenantId: 'org-a', db: drizzle(sqlite) };
    const { issueGatewayJwt } = await import('./gateway-jwt.service');

    try {
      const result = await issueGatewayJwt(ctx as never, '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6');
      const repeated = await issueGatewayJwt(ctx as never, '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6');
      const verify = (token: string) =>
        jwtVerify(token, publicKey, {
          issuer: 'https://hub.example.test',
          audience: 'openclaw-gateway',
        });
      const { payload } = await verify(result.token);
      const next = (await verify(repeated.token)).payload;
      expect(payload).toMatchObject({
        orgId: 'org-a',
        agentIds: ['agent-a'],
        sub: '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6',
      });
      expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
      expect(next.jti).not.toBe(payload.jti);
      expect(payload.exp! - payload.iat!).toBe(3600);
      expect(result.expiresAt).toBe(payload.exp! * 1000);
      expect(mocks.loadCanonicalProfile).toHaveBeenCalledWith(
        '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6',
      );
      expect(mocks.insertGatewaySigningKey).not.toHaveBeenCalled();
    } finally {
      sqlite.close();
    }
  });
});

test('refuses issuance from a stale tenant context after membership removal', async () => {
  mocks.hasCanonicalMembership.mockResolvedValue(false);
  const { issueGatewayJwt } = await import('./gateway-jwt.service');
  await expect(
    issueGatewayJwt({ tenantId: 'removed-org', db: {} as never }, 'removed-user'),
  ).rejects.toThrow('Active organization membership required');
  expect(mocks.hasCanonicalMembership).toHaveBeenLastCalledWith('removed-user', 'removed-org');
});

describe('spec 045 issuance claims', () => {
  async function issue(profileRole: string | null, opts?: { audience?: string }) {
    const { exportJWK, generateKeyPair, decodeJwt } = await import('jose');
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    mocks.openSecret.mockReturnValue(JSON.stringify(await exportJWK(privateKey)));
    mocks.listActiveGatewaySigningKeys.mockResolvedValue([
      { kid: 'k', alg: 'EdDSA', public_jwk: {}, private_ciphertext: 'c', private_iv: 'i' },
    ]);
    mocks.hasCanonicalMembership.mockResolvedValue(true);
    mocks.loadCanonicalProfile.mockResolvedValue({ id: 'u', role: profileRole });
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [] }) }) }),
    };
    const { issueGatewayJwt } = await import('./gateway-jwt.service');
    const result = await issueGatewayJwt({ tenantId: 'org-a', db } as never, 'u', opts);
    return { result, payload: decodeJwt(result.token) };
  }

  test.each([
    ['admin', 'admin'],
    ['user', 'user'],
    ['org_admin', 'user'],
    ['owner', 'user'],
    [null, 'user'],
  ])('platform role %s maps to gateway role %s', async (profileRole, expected) => {
    expect((await issue(profileRole)).payload.role).toBe(expected);
  });

  test('without an audience: legacy aud and the old hour', async () => {
    const { payload } = await issue('user');
    expect(payload.aud).toBe('openclaw-gateway');
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  test('with an audience: bound to that gateway for 900 s', async () => {
    const { payload, result } = await issue('user', { audience: 'gw:gw.example.test:8443' });
    expect(payload.aud).toBe('gw:gw.example.test:8443');
    expect(payload.exp! - payload.iat!).toBe(900);
    expect(result.expiresAt).toBe(payload.exp! * 1000);
  });

  test.each([
    ['wss://Faces-Gateway.Minion-AI.org', 'gw:faces-gateway.minion-ai.org'],
    ['wss://gw.example.test:443/ws?x=1', 'gw:gw.example.test'],
    ['ws://gw.example.test:80', 'gw:gw.example.test'],
    ['ws://GW.example.test:443', 'gw:gw.example.test:443'],
    ['https://gw.example.test:10000/', 'gw:gw.example.test:10000'],
    ['http://127.0.0.1:18790', 'gw:127.0.0.1:18790'],
  ])('gatewayAudience(%s) = %s', async (url, expected) => {
    const { gatewayAudience } = await import('./gateway-jwt.service');
    expect(gatewayAudience(url)).toBe(expected);
  });

  test.each(['ftp://gw.example.test', 'gw.example.test:18790', 'not a url'])(
    'gatewayAudience refuses %s',
    async (url) => {
      const { gatewayAudience } = await import('./gateway-jwt.service');
      expect(() => gatewayAudience(url)).toThrow();
    },
  );
});
