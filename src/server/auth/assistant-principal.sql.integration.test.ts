import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createClient } from '@supabase/supabase-js';
import { configureCache, createBackend } from '@minion-stack/cache';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
import {
  capturedPostgresDdl,
  mergeCapturedCatalogs,
  quoteCatalogIdentifier as qi,
  type CapturedCatalog,
} from '$server/test-utils/captured-postgres-catalog';
const entrypoints = vi.hoisted(() => ({ db: vi.fn(), admin: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: entrypoints.db }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: entrypoints.admin }));
import { resolveAssistantPrincipal } from './assistant-principal';
import { POST as overridePost } from '../../routes/api/roles/overrides/+server';
const ORG = '10000000-0000-4000-8000-000000000001',
  OTHER_ORG = '10000000-0000-4000-8000-000000000002';
const PROFILE = '20000000-0000-4000-8000-000000000001',
  OTHER_PROFILE = '20000000-0000-4000-8000-000000000002';
const GATEWAY = '30000000-0000-4000-8000-000000000001',
  OTHER_GATEWAY = '30000000-0000-4000-8000-000000000002';
const AGENT = 'Personal-Native_Actor';
const load = (name: string): { catalog: CapturedCatalog; provenance: Record<string, string> } =>
  JSON.parse(readFileSync(new URL(`../test-utils/fixtures/${name}`, import.meta.url), 'utf8'));
const attachment = load('attachment-catalog.json'),
  principal = load('assistant-principal-catalog.json'),
  auth = load('attachment-auth-catalog.json');
const catalog = mergeCapturedCatalogs(attachment.catalog, principal.catalog);
const schema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`,
  authSchema = `${schema}_auth`;
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let reader: ReturnType<typeof harness.createConnection>, writer: typeof reader;
const requests: { method: string; table: string }[] = [];
const transportTables = new Set(['organization_members', 'member_roles', 'permission_rules']);
/** Installed Supabase query builders, translated at the HTTP boundary to native
 * SQL over the captured catalog. This is NOT PostgREST/JWT/service-role RLS proof.
 * Mutations commit on a separate real connection before returning the response. */
const localTransport: typeof fetch = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url),
    table = url.pathname.replace('/rest/v1/', '');
  if (url.origin !== 'http://native-principal.invalid' || !transportTables.has(table))
    throw new Error('Unexpected native fixture HTTP target');
  const allowed = new Set(catalog.columns.filter((c) => c.relname === table).map((c) => c.attname));
  requests.push({ method: request.method, table });
  if (request.method === 'POST') {
    if (
      table !== 'permission_rules' ||
      url.searchParams.get('on_conflict') !== 'org_id,role_key,module'
    )
      throw new Error('Unexpected native fixture mutation');
    const row: Record<string, string | number | boolean | null> = await request.json();
    const columns = Object.keys(row);
    if (columns.some((c) => !allowed.has(c))) throw new Error('Unexpected mutation field');
    await writer.begin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO permission_rules (${columns.map(qi).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT(org_id,role_key,module) DO UPDATE SET ${columns
          .filter((c) => !['org_id', 'role_key', 'module'].includes(c))
          .map((c) => `${qi(c)}=EXCLUDED.${qi(c)}`)
          .join(',')}`,
        columns.map((c) => row[c]),
      );
    });
    return Response.json(null, { status: 201 });
  }
  if (request.method !== 'GET') throw new Error('Unexpected native fixture HTTP method');
  const selected = (url.searchParams.get('select') ?? '').split(',');
  if (selected.some((c) => !allowed.has(c)))
    throw new Error('Unexpected native fixture projection');
  const values: string[] = [],
    where: string[] = [];
  for (const [column, filter] of url.searchParams) {
    if (column === 'select') continue;
    if (!allowed.has(column)) throw new Error('Unexpected native fixture filter');
    if (filter.startsWith('eq.')) {
      values.push(filter.slice(3));
      where.push(`${qi(column)}=$${values.length}`);
    } else if (filter.startsWith('in.(') && filter.endsWith(')')) {
      const slots = filter
        .slice(4, -1)
        .split(',')
        .map((value) => {
          values.push(value);
          return `$${values.length}`;
        });
      where.push(`${qi(column)} IN (${slots.join(',')})`);
    } else throw new Error('Unsupported native fixture filter');
  }
  const rows = await reader.unsafe(
    `SELECT ${selected.map(qi).join(',')} FROM ${qi(table)}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`,
    values,
  );
  const single = request.headers.get('accept')?.includes('vnd.pgrst.object+json');
  return Response.json(single ? (rows[0] ?? null) : rows);
};
const gatewayLocals = (serverId = GATEWAY): App.Locals => ({
  serverId,
  tenantCtx: { db: {} as never, tenantId: ORG },
});
const requestUrl = () =>
  new URL(`http://native-principal.invalid/query?agentId=${encodeURIComponent(AGENT)}`);
const resolve = () => resolveAssistantPrincipal(gatewayLocals(), requestUrl());
beforeAll(async () => {
  harness = await openDisposablePostgres();
  const ddl = capturedPostgresDdl(schema, authSchema, catalog, auth.catalog);
  await harness.owner.unsafe(ddl);
  reader = harness.createConnection(schema);
  writer = harness.createConnection(schema);
  entrypoints.db.mockReturnValue(drizzle(reader));
  entrypoints.admin.mockReturnValue(
    createClient('http://native-principal.invalid', 'disposable-local-query-builder', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: localTransport },
    }),
  );
  console.info('principal native application/schema receipt', {
    ...harness.identity,
    schema,
    authSchema,
    sourceCatalogs: [attachment.provenance, principal.provenance, auth.provenance],
    ddlSha256: createHash('sha256').update(ddl).digest('hex'),
    providerProof: false,
    cacheBackend: 'actual-memory',
  });
});
beforeEach(async () => {
  requests.length = 0;
  configureCache({
    namespace: `native-principal-${crypto.randomUUID()}`,
    backend: createBackend({ backend: 'memory' }),
  });
  await harness.owner.unsafe(
    `TRUNCATE ${catalog.relations.map((r) => qi(r.relname)).join(',')},${qi(authSchema)}.users`,
  );
  await harness.owner.unsafe(
    `INSERT INTO ${qi(authSchema)}.users(id,email) VALUES ('${PROFILE}','principal@example.invalid'),('${OTHER_PROFILE}','other@example.invalid')`,
  );
  await writer`INSERT INTO organizations(id,name) VALUES (${ORG},'Native org'),(${OTHER_ORG},'Other native org')`;
  await writer`INSERT INTO organization_members(organization_id,profile_id,role) VALUES (${ORG},${PROFILE},'owner'),(${OTHER_ORG},${OTHER_PROFILE},'viewer')`;
  await writer`INSERT INTO gateway(id,legacy_server_id,org_id,name,url) VALUES (${GATEWAY},'legacy-native',${ORG},'Native','ws://fixture.invalid'),(${OTHER_GATEWAY},'legacy-other',${OTHER_ORG},'Other','ws://other.invalid')`;
  await writer`INSERT INTO personal_agents(id,profile_id,agent_id,display_name,gateway_id,provisioning_status) VALUES ('native-agent',${PROFILE},${AGENT},'Native agent',${GATEWAY},'active')`;
});
afterAll(async () => {
  if (harness)
    try {
      await harness.owner.unsafe(
        `DROP SCHEMA IF EXISTS ${qi(schema)} CASCADE;DROP SCHEMA IF EXISTS ${qi(authSchema)} CASCADE`,
      );
    } finally {
      await harness.close();
    }
  configureCache({ namespace: 'test', backend: createBackend({ backend: 'noop' }) });
});
describe('native assistant persisted assignment and revocation', () => {
  it.each([GATEWAY, 'legacy-native'])(
    'accepts current canonical/legacy gateway %s through actual joins',
    async (serverId) => {
      const resolved = await resolveAssistantPrincipal(gatewayLocals(serverId), requestUrl());
      expect(resolved).toMatchObject({ principalId: PROFILE, orgId: ORG, role: 'owner' });
      expect(resolved.capabilities.can('finance', 'view')).toBe(true);
    },
  );
  it('denies the next request after membership removal commits on another native connection', async () => {
    await resolve();
    await writer.begin(async (tx) => {
      await tx`DELETE FROM organization_members WHERE organization_id=${ORG} AND profile_id=${PROFILE}`;
    });
    await expect(resolve()).rejects.toMatchObject({
      status: 403,
      body: { code: 'ASSISTANT_ORG_NOT_ASSIGNED' },
    });
  });
  it('denies the next request after assignment removal commits on another native connection', async () => {
    await resolve();
    await writer.begin(async (tx) => {
      await tx`UPDATE personal_agents SET gateway_id=NULL WHERE profile_id=${PROFILE}`;
    });
    await expect(resolve()).rejects.toMatchObject({
      status: 403,
      body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED' },
    });
  });
  it('denies a gateway moved to another organization despite cached owner capabilities', async () => {
    await resolve();
    await writer`UPDATE gateway SET org_id=${OTHER_ORG} WHERE id=${GATEWAY}`;
    await expect(resolve()).rejects.toMatchObject({ status: 403 });
  });
  it('denies ambiguous aliases and inactive persisted provisioning', async () => {
    await writer`UPDATE gateway SET legacy_server_id=${GATEWAY} WHERE id=${OTHER_GATEWAY}`;
    await expect(resolve()).rejects.toMatchObject({ status: 403 });
    await writer`UPDATE gateway SET legacy_server_id='legacy-other' WHERE id=${OTHER_GATEWAY}`;
    await writer`UPDATE personal_agents SET provisioning_status='failed' WHERE profile_id=${PROFILE}`;
    await expect(resolve()).rejects.toMatchObject({ status: 403 });
  });
  it('actual authorized override route commits through second connection and invalidates the warm real cache', async () => {
    await writer`INSERT INTO member_roles(org_id,profile_id,role_key) VALUES (${ORG},${PROFILE},'viewer')`;
    expect((await resolve()).capabilities.can('finance', 'view')).toBe(true);
    const before = requests.filter(
      (r) => r.table === 'permission_rules' && r.method === 'GET',
    ).length;
    await resolve();
    expect(
      requests.filter((r) => r.table === 'permission_rules' && r.method === 'GET'),
    ).toHaveLength(before);
    const response = await overridePost({
      locals: {
        user: { id: PROFILE, supabaseId: PROFILE, role: 'admin' },
        tenantCtx: { tenantId: ORG },
      },
      request: new Request('http://native-principal.invalid/api/roles/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleKey: 'viewer', module: 'finance', caps: { view: false } }),
      }),
    } as never);
    expect(response.status).toBe(200);
    expect(requests).toContainEqual({ method: 'POST', table: 'permission_rules' });
    expect((await resolve()).capabilities.can('finance', 'view')).toBe(false);
    expect(
      requests.filter((r) => r.table === 'permission_rules' && r.method === 'GET').length,
    ).toBeGreaterThan(before);
  });
  it('denies a nonmember override request before any native permission mutation', async () => {
    await expect(
      overridePost({
        locals: {
          user: { id: OTHER_PROFILE, supabaseId: OTHER_PROFILE, role: 'user' },
          tenantCtx: { tenantId: ORG },
        },
        request: new Request('http://native-principal.invalid/api/roles/overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roleKey: 'viewer', module: 'finance', caps: { view: true } }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });
});
