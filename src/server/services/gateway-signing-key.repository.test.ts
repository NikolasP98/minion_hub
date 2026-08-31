import { beforeEach, describe, expect, test, vi } from 'vitest';

const queryResults = vi.hoisted(() => [] as unknown[][]);
const sql = vi.hoisted(() =>
  vi.fn(
    async (_strings: TemplateStringsArray, ..._values: unknown[]) => queryResults.shift() ?? [],
  ),
);

vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => sql }));

import {
  insertGatewaySigningKey,
  listActiveGatewaySigningKeys,
  listGatewayPublicJwks,
} from './gateway-signing-key.repository';

beforeEach(() => {
  vi.clearAllMocks();
  queryResults.length = 0;
});

describe('gateway signing-key repository', () => {
  test('loads active private keys directly from canonical Postgres', async () => {
    queryResults.push([
      {
        kid: 'kid-1',
        alg: 'EdDSA',
        public_jwk: { kid: 'kid-1', kty: 'OKP' },
        private_ciphertext: 'ciphertext',
        private_iv: 'iv',
      },
    ]);

    const rows = await listActiveGatewaySigningKeys();

    expect(rows).toHaveLength(1);
    const query = sql.mock.calls[0]?.[0].join(' ');
    expect(query).toContain('from public.gateway_signing_keys');
    expect(query).toContain('where active = true');
  });

  test('loads public JWKS without the PostgREST client', async () => {
    queryResults.push([{ public_jwk: { kid: 'kid-1', kty: 'OKP' } }]);

    await expect(listGatewayPublicJwks()).resolves.toHaveLength(1);
    expect(sql.mock.calls[0]?.[0].join(' ')).toContain('select public_jwk');
  });

  test('serializes the public JWK into the canonical insert', async () => {
    await insertGatewaySigningKey({
      kid: 'kid-1',
      alg: 'EdDSA',
      public_jwk: { kid: 'kid-1', kty: 'OKP' },
      private_ciphertext: 'ciphertext',
      private_iv: 'iv',
    });

    const values = sql.mock.calls[0]?.slice(1);
    expect(values).toContain(JSON.stringify({ kid: 'kid-1', kty: 'OKP' }));
    expect(sql.mock.calls[0]?.[0].join(' ')).toContain('insert into public.gateway_signing_keys');
  });
});
