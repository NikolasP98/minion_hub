import { describe, expect, it } from 'vitest';
import { buildEnvQa, parseSupabaseStatusEnv } from './env';
import { OUTBOUND_SERVICE_ENV_KEYS } from './backend';

// A representative `supabase status -o env` blob (KEY="value" per line, the
// same shape scripts/qa/snapshot-env.ts's parseEnvFile already handles).
const FAKE_STATUS_ENV = `
API_URL="http://127.0.0.1:54421"
GRAPHQL_URL="http://127.0.0.1:54421/graphql/v1"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
STUDIO_URL="http://127.0.0.1:54423"
ANON_KEY="eyJfake.anon.key"
SERVICE_ROLE_KEY="eyJfake.service.key"
`;

describe('parseSupabaseStatusEnv', () => {
  it('extracts the four values qa:env needs', () => {
    expect(parseSupabaseStatusEnv(FAKE_STATUS_ENV)).toEqual({
      apiUrl: 'http://127.0.0.1:54421',
      dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
      anonKey: 'eyJfake.anon.key',
      serviceRoleKey: 'eyJfake.service.key',
    });
  });

  it('throws with the missing key names when the CLI output shape changes', () => {
    expect(() => parseSupabaseStatusEnv('API_URL="http://127.0.0.1:54421"\n')).toThrow(
      /DB_URL, ANON_KEY, SERVICE_ROLE_KEY/,
    );
  });
});

describe('buildEnvQa', () => {
  const status = {
    apiUrl: 'http://127.0.0.1:54421',
    dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
    anonKey: 'eyJfake.anon.key',
    serviceRoleKey: 'eyJfake.service.key',
  };

  it('writes the same URL for both PUBLIC_SUPABASE_URL and the server-side client (network_mode: host)', () => {
    const body = buildEnvQa(status, 'deadbeef');
    expect(body).toContain('PUBLIC_SUPABASE_URL=http://127.0.0.1:54421');
    expect(body).toContain(
      'SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres',
    );
    expect(body).toContain('SUPABASE_SERVICE_ROLE_KEY=eyJfake.service.key');
    expect(body).toContain('ENCRYPTION_KEY=deadbeef');
    expect(body).toContain('AUTH_PROVIDER=supabase');
    expect(body).toContain('TURSO_DB_URL=file:./data/qa/minion_hub.db');
  });

  it('appends developer QA-only keys last so they win over everything above', () => {
    const body = buildEnvQa(status, 'deadbeef', { PERUDEVS_API_KEY: 'dev-key' });
    const lines = body.trim().split('\n');
    expect(lines.at(-1)).toBe('PERUDEVS_API_KEY=dev-key');
    expect(buildEnvQa(status, 'deadbeef')).not.toContain('PERUDEVS');
  });

  it('forces every outbound-service key to an explicit empty stub, never left unset', () => {
    const body = buildEnvQa(status, 'deadbeef');
    for (const key of OUTBOUND_SERVICE_ENV_KEYS) {
      expect(body).toContain(`\n${key}=\n`);
    }
    // A representative sample, spelled out so a future rename/typo in the
    // OUTBOUND_SERVICE_ENV_KEYS list still fails this test even if the loop
    // above silently iterates over an empty/renamed array.
    expect(body).toContain('\nRESEND_API_KEY=\n');
    expect(body).toContain('\nB2_APP_KEY=\n');
    expect(body).toContain('\nGITHUB_TOKEN=\n');
    expect(body).toContain('\nOPENAI_API_KEY=\n');
    expect(body).toContain('\nSENTRY_DSN=\n');
    expect(body).toContain('\nMINION_GATEWAY_BROADCAST_URL=\n');
  });
});
