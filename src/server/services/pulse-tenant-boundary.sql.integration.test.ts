import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type postgres from 'postgres';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({
  pool: vi.fn(),
  env: {
    AUTH_DISABLED: 'false',
    GATEWAY_TURSO_FALLBACK: 'false',
    DESKTOP: '0',
  } as Record<string, string>,
}));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('$server/env-hoist', () => ({}));
vi.mock('$env/dynamic/private', () => ({ env: boundary.env }));
vi.mock('$server/db/client', () => ({ getDb: () => ({ fixture: 'legacy-db-handle' }) }));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: vi.fn(),
  supabaseServer: () => ({
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  }),
}));
vi.mock('$server/auth/supabase-bridge.runtime', () => ({
  resolveSupabaseUser: vi.fn(),
  resolveSupabaseTenant: vi.fn(),
}));
vi.mock('@sentry/sveltekit', () => ({
  init: vi.fn(),
  sentryHandle:
    () =>
    ({ event, resolve }: Parameters<Handle>[0]) =>
      resolve(event),
  handleErrorWithSentry: (handler: unknown) => handler,
}));
vi.mock('$lib/i18n', () => ({
  i18n: {
    handle:
      () =>
      ({ event, resolve }: Parameters<Handle>[0]) =>
        resolve(event),
  },
}));
vi.mock('$lib/server/cache', () => ({
  initCache: async () => {},
  initCacheDataPlane: async () => {},
}));
vi.mock('$lib/server/posthog', () => ({
  captureServerEvent: vi.fn(),
  getPostHogClient: async () => null,
}));
vi.mock('$lib/server/server-timing', () => ({
  createServerTimingHandle:
    () =>
    ({ event, resolve }: Parameters<Handle>[0]) =>
      resolve(event),
}));
vi.mock('$server/http/plan-operation-cache', () => ({
  planOperationCacheHandle: ({ event, resolve }: Parameters<Handle>[0]) => resolve(event),
}));
vi.mock('$server/services/modules.service', () => ({ listModuleStates: async () => ({}) }));
vi.mock('$server/services/rbac.service', () => ({
  apiWriteCapability: () => null,
  hasOrgCapability: async () => false,
}));
vi.mock('$server/services/user-preferences.service', () => ({
  getUserPreferences: async () => ({}),
}));
vi.mock('$server/ai-usage', () => ({
  runWithAiUsageScope: (_scope: unknown, fn: () => unknown) => fn(),
  setAiUsageOrg: vi.fn(),
}));
vi.mock('$server/services/gateway.pg.service', () => ({
  isGatewayChannel: (channel: string) => ['prd', 'dev'].includes(channel),
}));
vi.mock('$lib/server/workforce-identity', () => ({ mintWorkforceIdentity: vi.fn() }));
vi.mock('$lib/server/workforce-viewer', () => ({ trustedWorkforceViewerRoleKeys: vi.fn() }));

import { POST } from '../../routes/api/gateway/pulse/proposals/+server';
import { handle } from '../../hooks.server';

type Client = ReturnType<typeof postgres>;
type PulsePost = (event: {
  locals: { serverId: string; tenantCtx: { tenantId: string } };
  request: Request;
}) => Promise<Response>;

let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client;
let app: Client;
const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
const ORG_A = '10000000-0000-4000-8000-0000000000a1';
const ORG_B = '10000000-0000-4000-8000-0000000000b2';
const GATEWAY_A = '20000000-0000-4000-8000-0000000000a1';
const GATEWAY_B = '20000000-0000-4000-8000-0000000000b2';
const GATEWAY_INCOMPLETE = '20000000-0000-4000-8000-0000000000c3';
const TOKEN_A = 'pulse-native-token-a';
const TOKEN_B = 'pulse-native-token-b';
const TOKEN_INCOMPLETE = 'pulse-native-token-incomplete';

function requestBody(orgId?: string) {
  return {
    ...(orgId === undefined ? {} : { orgId }),
    proposals: [
      {
        source: 'native-fixture',
        kind: 'fyi',
        title: 'Bounded tenant proposal',
        payload: { fixture: true },
        dedupKey: 'native-pulse-dedup',
      },
    ],
  };
}

async function post(tenantId: string, body: Record<string, unknown>) {
  return (POST as PulsePost)({
    locals: { serverId: 'native-gateway', tenantCtx: { tenantId } },
    request: new Request('http://hub.invalid/api/gateway/pulse/proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

const kitRuntimePath = '@sveltejs/kit/internal/server';
const kitRuntime = (await import(kitRuntimePath)) as {
  with_request_store: <T>(store: unknown, fn: () => T) => T;
};

function requestEvent(
  body: Record<string, unknown>,
  authorization?: string,
  serverIdHint?: string,
) {
  const url = new URL('https://hub.invalid/api/gateway/pulse/proposals');
  const headers = new Headers({ 'content-type': 'application/json' });
  if (authorization) headers.set('authorization', authorization);
  if (serverIdHint) headers.set('x-minion-server-id', serverIdHint);
  return {
    url,
    request: new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }),
    locals: {},
    route: { id: '/api/gateway/pulse/proposals' },
    cookies: {
      get: () => undefined,
      getAll: () => [],
      delete: vi.fn(),
      set: vi.fn(),
    },
    setHeaders: vi.fn(),
    getClientAddress: () => '127.0.0.1',
    fetch,
    params: {},
  } as unknown as RequestEvent;
}

function invokeThroughHook(
  body: Record<string, unknown>,
  authorization?: string,
  serverIdHint?: string,
) {
  const event = requestEvent(body, authorization, serverIdHint);
  const seen: Array<{ tenantId: string | undefined; serverId: string | undefined }> = [];
  const response = kitRuntime.with_request_store(
    {
      event,
      state: {
        tracing: { record_span: ({ fn }: { fn: (span: undefined) => unknown }) => fn(undefined) },
      },
    },
    () =>
      handle({
        event,
        resolve: (resolved) => {
          seen.push({
            tenantId: resolved.locals.tenantCtx?.tenantId,
            serverId: resolved.locals.serverId,
          });
          return POST(resolved);
        },
      }),
  );
  return { response, seen };
}

beforeAll(async () => {
  harness = await openDisposablePostgres();
  await harness.owner.unsafe(`CREATE SCHEMA "${schema}"`);
  owner = harness.createConnection(schema);
  app = harness.createConnection(schema);
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20260718050000_pulse.sql', import.meta.url),
    'utf8',
  );
  await owner.unsafe(migration.replaceAll('public.', `"${schema}".`));
  await owner.unsafe(`CREATE TABLE gateway (
      id uuid PRIMARY KEY,
      legacy_server_id text,
      org_id uuid,
      name text NOT NULL,
      url text NOT NULL,
      token_ciphertext text NOT NULL DEFAULT '',
      token_iv text NOT NULL DEFAULT '',
      auth_mode text NOT NULL DEFAULT 'token',
      last_connected_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    INSERT INTO gateway (id,legacy_server_id,org_id,name,url,token_ciphertext) VALUES
      ('${GATEWAY_A}','native-machine-a','${ORG_A}','Machine A','wss://a.invalid','${TOKEN_A}'),
      ('${GATEWAY_B}','native-machine-b','${ORG_B}','Machine B','wss://b.invalid','${TOKEN_B}'),
      ('${GATEWAY_INCOMPLETE}','native-machine-incomplete',NULL,'Incomplete','wss://incomplete.invalid','${TOKEN_INCOMPLETE}');
    GRANT USAGE ON SCHEMA "${schema}" TO app_ledger`);
  boundary.pool.mockImplementation(() => app);
}, 20_000);

beforeEach(async () => {
  await owner`TRUNCATE pulse_proposals,pulse_settings`;
});

afterAll(async () => {
  if (!harness) return;
  try {
    await harness.owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    expect(await harness.owner`SELECT nspname FROM pg_namespace WHERE nspname=${schema}`).toEqual(
      [],
    );
  } finally {
    await harness.close();
  }
});

describe('native Pulse tenant boundary', () => {
  it('binds machine identity to route storage and same-org dedupe under actual RLS', async () => {
    const mismatch = await post(ORG_A, requestBody(ORG_B));
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ ok: false, error: 'tenant_mismatch' });
    expect(await owner`SELECT id FROM pulse_proposals`).toEqual([]);

    const initial = await post(ORG_A, requestBody());
    expect(initial.status).toBe(201);
    expect(await initial.json()).toEqual({ ok: true, inserted: 1, skipped: 0 });

    const retry = await post(ORG_A, requestBody(ORG_A));
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({ ok: true, inserted: 0, skipped: 1 });

    const otherTenant = await post(ORG_B, requestBody());
    expect(otherTenant.status).toBe(201);
    expect(await otherTenant.json()).toEqual({ ok: true, inserted: 1, skipped: 0 });
    expect(await owner`SELECT org_id,dedup_key FROM pulse_proposals ORDER BY org_id`).toEqual([
      { org_id: ORG_A, dedup_key: 'native-pulse-dedup' },
      { org_id: ORG_B, dedup_key: 'native-pulse-dedup' },
    ]);
  });

  it('resolves real server credentials through the hook and rejects browser or incomplete machines before storage', async () => {
    const acceptedA = invokeThroughHook(requestBody(), `Bearer ${TOKEN_A}`, 'native-machine-a');
    const responseA = await acceptedA.response;
    expect(responseA.status).toBe(201);
    expect(await responseA.json()).toEqual({ ok: true, inserted: 1, skipped: 0 });
    expect(acceptedA.seen).toEqual([{ tenantId: ORG_A, serverId: 'native-machine-a' }]);

    const acceptedB = invokeThroughHook(requestBody(), `Bearer ${TOKEN_B}`);
    const responseB = await acceptedB.response;
    expect(responseB.status).toBe(201);
    expect(await responseB.json()).toEqual({ ok: true, inserted: 1, skipped: 0 });
    expect(acceptedB.seen).toEqual([{ tenantId: ORG_B, serverId: 'native-machine-b' }]);

    const mismatch = await invokeThroughHook(requestBody(ORG_B), `Bearer ${TOKEN_A}`).response;
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ ok: false, error: 'tenant_mismatch' });

    for (const [authorization, hint] of [
      [undefined, undefined],
      [`Bearer ${TOKEN_INCOMPLETE}`, undefined],
      [`Bearer ${TOKEN_A}`, 'native-machine-b'],
    ] as const) {
      const rejected = await invokeThroughHook(requestBody(), authorization, hint).response;
      expect(rejected.status).toBe(401);
      expect(await rejected.json()).toEqual({
        ok: false,
        error: 'machine_identity_required',
      });
    }
    expect(await owner`SELECT org_id FROM pulse_proposals ORDER BY org_id`).toEqual([
      { org_id: ORG_A },
      { org_id: ORG_B },
    ]);
  });

  it('enables Pulse RLS for the restricted ledger role without claiming FORCE', async () => {
    await owner`INSERT INTO pulse_proposals (org_id,source,kind,title,dedup_key) VALUES
      (${ORG_A},'fixture','fyi','Visible A','rls-a'),
      (${ORG_B},'fixture','fyi','Hidden B','rls-b')`;

    const [role] = await owner`SELECT rolsuper,rolbypassrls,
      pg_get_userbyid(c.relowner) AS table_owner
      FROM pg_roles CROSS JOIN pg_class c
      WHERE rolname='app_ledger' AND c.oid=${`${schema}.pulse_proposals`}::regclass`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, table_owner: 'minion_qc' });
    const tables = await owner`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid IN (${`${schema}.pulse_proposals`}::regclass,${`${schema}.pulse_settings`}::regclass)
      ORDER BY relname`;
    expect(tables).toEqual([
      { relname: 'pulse_proposals', relrowsecurity: true, relforcerowsecurity: false },
      { relname: 'pulse_settings', relrowsecurity: true, relforcerowsecurity: false },
    ]);
    const [privileges] = await owner`SELECT
      has_table_privilege('app_ledger',${`${schema}.pulse_proposals`},'SELECT') AS read,
      has_table_privilege('app_ledger',${`${schema}.pulse_proposals`},'INSERT') AS write,
      has_table_privilege('app_ledger',${`${schema}.pulse_proposals`},'UPDATE') AS change,
      has_table_privilege('app_ledger',${`${schema}.pulse_proposals`},'DELETE') AS remove`;
    expect(privileges).toEqual({ read: true, write: true, change: true, remove: true });

    const visible = await app.begin(async (tx) => {
      await tx`SET LOCAL ROLE app_ledger`;
      await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
      expect(
        await tx`UPDATE pulse_proposals SET title='Blocked update' WHERE org_id=${ORG_B} RETURNING id`,
      ).toEqual([]);
      return tx`SELECT org_id,title FROM pulse_proposals ORDER BY org_id`;
    });
    expect(visible).toEqual([{ org_id: ORG_A, title: 'Visible A' }]);

    await expect(
      app.begin(async (tx) => {
        await tx`SET LOCAL ROLE app_ledger`;
        await tx`SELECT set_config('app.current_org_id',${ORG_A},true)`;
        await tx`INSERT INTO pulse_proposals (org_id,source,kind,title,dedup_key)
          VALUES (${ORG_B},'fixture','fyi','Foreign insert','foreign')`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await owner`SELECT title FROM pulse_proposals WHERE org_id=${ORG_B}`).toEqual([
      { title: 'Hidden B' },
    ]);
  });
});
