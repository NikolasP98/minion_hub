import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCanonicalProfile: vi.fn(),
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

vi.mock('@minion-stack/db/schema', () => ({
  userAgents: { userId: 'userId', agentId: 'agentId' },
}));

describe('gateway JWT issuance', () => {
  beforeEach(() => vi.clearAllMocks());

  test('reads identity and signing material without depending on PostgREST', async () => {
    const { exportJWK, generateKeyPair } = await import('jose');
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
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
    const ctx = {
      tenantId: 'org-a',
      db: {
        select: () => ({
          from: () => ({
            where: async () => [{ agentId: 'agent-1' }, { agentId: 'agent-1' }],
          }),
        }),
      },
    };
    const { issueGatewayJwt } = await import('./gateway-jwt.service');

    const result = await issueGatewayJwt(ctx as never, '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6');

    expect(result.token.split('.')).toHaveLength(3);
    expect(mocks.loadCanonicalProfile).toHaveBeenCalledWith('3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6');
    expect(mocks.listActiveGatewaySigningKeys).toHaveBeenCalledOnce();
    expect(mocks.insertGatewaySigningKey).not.toHaveBeenCalled();
  });
});
