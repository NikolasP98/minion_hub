#!/usr/bin/env bun
/**
 * Spec 045 T040 — owner-run launch probe for per-gateway JWTs (design §5 steps 1–2).
 *
 *   bun scripts/qa/gateway-jwt-probe.ts --list-audiences
 *     Every `gatewayAudience(row.url)`, grouped by value. Paste these (never type
 *     them: the gateway compares `aud` as an exact string) into that gateway's
 *     `multiTenant.jwtOnlyAudiences` and `oidcIssuers[].audience`.
 *
 *   bun scripts/qa/gateway-jwt-probe.ts <gatewayId> <userId>
 *     Mints a JWT server-side for that user, the gateway's org and its audience,
 *     connects JWT-only (no shared token), and checks: health, a read and a write
 *     method allowed; an admin method allowed only for a platform admin; a JWT
 *     minted for another `gw:` audience refused.
 *
 * Read-only: it selects gateway, profile and signing-key rows and writes nothing.
 * It refuses to run when no active signing key opens with this ENCRYPTION_KEY,
 * because issuance would then insert a new key. Never prints a token or secret.
 * Exits 1 on any mismatch. Needs the hub's env (SUPABASE_DB_URL, ENCRYPTION_KEY,
 * TURSO_*, MINION_HUB_ORIGIN or the hub URL for the WS Origin header).
 */
import '../_sveltekit-bun-shim.ts';
import WebSocket from 'ws';
import { GatewayClient } from '@minion-stack/shared';
import { listAudiences, runProbe, type GatewayRow, type ProbeSocket } from './gateway-jwt-probe-core';

const USAGE =
  'usage: bun scripts/qa/gateway-jwt-probe.ts --list-audiences | <gatewayId> <userId>';

function wsUrl(raw: string): string {
  return raw.replace(/^http(s?):\/\//, 'ws$1://');
}

async function gatewayRows(): Promise<GatewayRow[]> {
  const { getCoreDb } = await import('../../src/server/db/pg-client.ts');
  const { gateway } = await import('@minion-stack/db/pg');
  return getCoreDb()
    .select({ id: gateway.id, url: gateway.url, orgId: gateway.orgId })
    .from(gateway);
}

async function listMode(): Promise<number> {
  const { gatewayAudience } = await import('../../src/server/services/gateway-jwt.service.ts');
  const { groups, invalid } = listAudiences(await gatewayRows(), gatewayAudience);
  for (const group of groups) {
    console.log(group.audience);
    for (const row of group.gateways) console.log(`  ${row.id}  ${row.url}  org=${row.orgId ?? '-'}`);
  }
  for (const { row, reason } of invalid) console.error(`! ${row.id} ${row.url}: ${reason}`);
  return invalid.length ? 1 : 0;
}

/** Issuance inserts a fresh signing key when none opens here: refuse instead (read-only). */
async function assertSigningKeyUsable(): Promise<void> {
  const { listActiveGatewaySigningKeys } = await import(
    '../../src/server/services/gateway-signing-key.repository.ts'
  );
  const { openSecret } = await import('@minion-stack/db/pg');
  const rows = await listActiveGatewaySigningKeys();
  const usable = rows.some((row) => {
    try {
      openSecret(row.private_ciphertext, row.private_iv);
      return true;
    } catch {
      return false;
    }
  });
  if (!usable) {
    throw new Error('no active gateway signing key opens with this ENCRYPTION_KEY; refusing to mint');
  }
}

function connectJwtOnly(url: string, jwt: string): Promise<ProbeSocket> {
  const origin =
    process.env.MINION_HUB_ORIGIN ||
    process.env.PUBLIC_HUB_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '');
  const client = new GatewayClient({
    url: wsUrl(url),
    autoReconnect: false,
    WebSocketImpl: WebSocket,
    wsConstructorArgs: origin ? [{ headers: { Origin: origin } }] : [],
    // The dashboard's own connect frame, minus the shared token (spec 045 §3.2).
    onChallenge: async () => ({
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: 'minion-control-ui', version: '1.0', platform: 'node', mode: 'ui' },
      role: 'operator',
      scopes: [
        'operator.admin',
        'operator.read',
        'operator.write',
        'operator.approvals',
        'operator.pairing',
      ],
      caps: [],
      jwt,
    }),
  } as ConstructorParameters<typeof GatewayClient>[0]);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('connect timeout')), 15_000).unref?.(),
  );
  return Promise.race([client.connect(), timeout]).then(
    () => ({
      call: (method, params) => client.request(method, params, { timeoutMs: 15_000 }),
      close: () => client.close(),
    }),
    (err) => {
      client.close();
      throw err;
    },
  );
}

async function probeMode(gatewayId: string, userId: string): Promise<number> {
  const rows = await gatewayRows();
  const row = rows.find((r) => r.id === gatewayId);
  if (!row) throw new Error(`gateway ${gatewayId} not found`);
  if (!row.orgId) throw new Error(`gateway ${gatewayId} has no org`);
  const { gatewayAudience, issueGatewayJwt } = await import(
    '../../src/server/services/gateway-jwt.service.ts'
  );
  const { loadCanonicalProfile } = await import(
    '../../src/server/services/canonical-directory.service.ts'
  );
  const { getDb } = await import('../../src/server/db/client.ts');
  const profile = await loadCanonicalProfile(userId);
  if (!profile) throw new Error(`profile ${userId} not found`);
  await assertSigningKeyUsable();

  const audience = gatewayAudience(row.url);
  const isPlatformAdmin = profile.role === 'admin';
  console.log(`gateway ${row.id} ${row.url}`);
  console.log(`audience ${audience}  user ${userId} (${isPlatformAdmin ? 'platform admin' : 'member'})`);

  const { lines, ok } = await runProbe({
    audience,
    isPlatformAdmin,
    deps: {
      mint: async (aud) =>
        (await issueGatewayJwt({ db: getDb(), tenantId: row.orgId! }, userId, { audience: aud }))
          .token,
      connect: (jwt) => connectJwtOnly(row.url, jwt),
    },
  });
  for (const line of lines) {
    const mark = line.actual === line.expected ? 'ok  ' : 'FAIL';
    console.log(
      `${mark} ${line.name}: expected ${line.expected}, got ${line.actual}` +
        (line.detail ? ` (${line.detail})` : ''),
    );
  }
  console.log(ok ? 'PASS' : 'MISMATCH');
  return ok ? 0 : 1;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--list-audiences') return listMode();
  if (args.length === 2 && !args.some((a) => a.startsWith('-'))) return probeMode(args[0], args[1]);
  console.error(USAGE);
  return 2;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`probe failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
