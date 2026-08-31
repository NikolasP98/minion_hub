import type { JWK } from 'jose';
import { getPgClient } from '$server/db/pg-pool';

export interface GatewaySigningKeyRow {
  kid: string;
  alg: string;
  public_jwk: JWK;
  private_ciphertext: string;
  private_iv: string;
}

/**
 * Read JWT signing keys from canonical Postgres, not the optional PostgREST
 * data plane. JWT issuance is part of authentication and must remain available
 * when Supabase's REST gateway is restarting or temporarily unhealthy.
 */
export async function listActiveGatewaySigningKeys(): Promise<GatewaySigningKeyRow[]> {
  return getPgClient()<GatewaySigningKeyRow[]>`
    select kid, alg, public_jwk, private_ciphertext, private_iv
    from public.gateway_signing_keys
    where active = true
    order by created_at desc
  `;
}

export async function listGatewayPublicJwks(): Promise<Array<{ public_jwk: JWK }>> {
  return getPgClient()<Array<{ public_jwk: JWK }>>`
    select public_jwk
    from public.gateway_signing_keys
    order by created_at desc
  `;
}

export async function insertGatewaySigningKey(row: GatewaySigningKeyRow): Promise<void> {
  const publicJwk = JSON.stringify(row.public_jwk);
  await getPgClient()`
    insert into public.gateway_signing_keys
      (kid, alg, public_jwk, private_ciphertext, private_iv, active)
    values
      (${row.kid}, ${row.alg}, ${publicJwk}::jsonb, ${row.private_ciphertext}, ${row.private_iv}, true)
  `;
}
