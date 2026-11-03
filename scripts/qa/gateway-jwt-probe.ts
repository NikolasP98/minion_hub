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
 *     method allowed; an admin method allowed only for a platform admin; for a
 *     member, a label-only sessions.patch allowed on an agent in the JWT and
 *     refused on any other; a JWT minted for another `gw:` audience closed 1008
 *     with the audience refusal (a timeout or any other error is a FAIL).
 *
 * Writes nothing to the hub: it selects gateway, profile, signing-key and
 * agent-assignment rows. It refuses to run when no active signing key can be
 * used exactly as issuance uses it (issuance would insert a new key), and when
 * TURSO_DB_URL is unset (issuance would read an empty local file DB). On the
 * gateway, a member run labels one dedicated session `agent:<id>:jwt-probe`.
 * Never prints a token or secret. Exits 1 on any mismatch. Needs the hub's env
 * (SUPABASE_DB_URL, ENCRYPTION_KEY, TURSO_DB_URL/TURSO_DB_AUTH_TOKEN,
 * MINION_HUB_ORIGIN or the hub URL for the WS Origin header).
 */
import '../_sveltekit-bun-shim.ts';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { decodeJwt, importJWK, type JWK } from 'jose';
import { GatewayClient } from '@minion-stack/shared';
import {
  listAudiences,
  runProbe,
  type ConnectOutcome,
  type GatewayRow,
  type ProbeSocket,
} from './gateway-jwt-probe-core';

const USAGE = 'usage: bun scripts/qa/gateway-jwt-probe.ts --list-audiences | <gatewayId> <userId>';

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
    for (const row of group.gateways)
      console.log(`  ${row.id}  ${row.url}  org=${row.orgId ?? '-'}`);
  }
  for (const { row, reason } of invalid) console.error(`! ${row.id} ${row.url}: ${reason}`);
  return invalid.length ? 1 : 0;
}

/**
 * Issuance inserts a fresh signing key when no active one loads here, so refuse
 * instead: each row is loaded exactly as `loadActiveSigningKey` does (open,
 * parse, import).
 */
async function assertSigningKeyUsable(): Promise<void> {
  const { listActiveGatewaySigningKeys } =
    await import('../../src/server/services/gateway-signing-key.repository.ts');
  const { openSecret } = await import('@minion-stack/db/pg');
  const rows = await listActiveGatewaySigningKeys();
  let usable = false;
  for (const row of rows) {
    try {
      const jwk = JSON.parse(openSecret(row.private_ciphertext, row.private_iv)) as JWK;
      await importJWK(jwk, row.alg);
      usable = true;
      break;
    } catch {
      /* sealed by another ENCRYPTION_KEY or malformed: issuance would skip it too */
    }
  }
  if (!usable) {
    throw new Error(
      'no active gateway signing key opens with this ENCRYPTION_KEY; refusing to mint',
    );
  }
}

function hubOrigin(): string {
  return (
    process.env.MINION_HUB_ORIGIN ||
    process.env.PUBLIC_HUB_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '')
  );
}

/** The dashboard's own connect frame, minus the shared token (spec 045 §3.2). */
function connectParams(jwt: string) {
  return {
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
  };
}

/**
 * Raw socket for the refusal check: waits for the gateway's own close frame
 * (code and reason) instead of closing first on the error response.
 */
function connectOutcome(url: string, jwt: string): Promise<ConnectOutcome> {
  return new Promise((resolve, reject) => {
    const origin = hubOrigin();
    const ws = new WebSocket(wsUrl(url), origin ? { headers: { Origin: origin } } : {});
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('connect timeout'));
    }, 15_000);
    let connectId = '';
    ws.on('message', (raw) => {
      let frame: { type?: string; event?: string; id?: string; ok?: boolean };
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        connectId = randomUUID();
        ws.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: connectParams(jwt) })); // prettier-ignore
      } else if (frame.type === 'res' && frame.id === connectId && frame.ok) {
        clearTimeout(timer);
        resolve({ admitted: true });
        ws.close();
      }
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ admitted: false, code, reason: reason.toString() });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function connectJwtOnly(url: string, jwt: string): Promise<ProbeSocket> {
  const origin = hubOrigin();
  const client = new GatewayClient({
    url: wsUrl(url),
    autoReconnect: false,
    WebSocketImpl: WebSocket,
    wsConstructorArgs: origin ? [{ headers: { Origin: origin } }] : [],
    onChallenge: async () => connectParams(jwt),
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
  // getDb() falls back to a local file DB: issuance would read no assignments from it.
  if (!process.env.TURSO_DB_URL?.trim()) throw new Error('TURSO_DB_URL is not set');
  const rows = await gatewayRows();
  const row = rows.find((r) => r.id === gatewayId);
  if (!row) throw new Error(`gateway ${gatewayId} not found`);
  if (!row.orgId) throw new Error(`gateway ${gatewayId} has no org`);
  const { gatewayAudience, issueGatewayJwt } =
    await import('../../src/server/services/gateway-jwt.service.ts');
  const { loadCanonicalProfile } =
    await import('../../src/server/services/canonical-directory.service.ts');
  const { getDb } = await import('../../src/server/db/client.ts');
  const profile = await loadCanonicalProfile(userId);
  if (!profile) throw new Error(`profile ${userId} not found`);
  await assertSigningKeyUsable();

  const audience = gatewayAudience(row.url);
  const isPlatformAdmin = profile.role === 'admin';
  console.log(`gateway ${row.id} ${row.url}`);
  console.log(
    `audience ${audience}  user ${userId} (${isPlatformAdmin ? 'platform admin' : 'member'})`,
  );

  const { lines, ok } = await runProbe({
    audience,
    isPlatformAdmin,
    deps: {
      mint: async (aud) =>
        (await issueGatewayJwt({ db: getDb(), tenantId: row.orgId! }, userId, { audience: aud }))
          .token,
      agentIds: (jwt) => {
        const ids = decodeJwt(jwt).agentIds;
        return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
      },
      connect: (jwt) => connectJwtOnly(row.url, jwt),
      connectOutcome: (jwt) => connectOutcome(row.url, jwt),
    },
  });
  for (const line of lines) {
    const mark =
      line.actual === 'skipped' ? 'skip' : line.actual === line.expected ? 'ok  ' : 'FAIL';
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
