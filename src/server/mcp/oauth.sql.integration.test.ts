import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';

/**
 * Native-Postgres qualification of the credential rules that need real statements (spec 143
 * P2, P3, P11, P15, P18): spend races, renewal grace, code replay. The tables come from the
 * migration itself, in a throwaway schema.
 */
const boundary = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: boundary.db }));

import {
  createCode,
  exchangeCode,
  membershipSince,
  refresh,
  registerClient,
} from './oauth.service';

const databaseUrl = testDatabaseUrl();
if (!databaseUrl)
  throw new Error('MCP OAuth native qualification requires explicit HUB_TEST_DB_URL');
const url = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port)
  throw new Error('MCP OAuth native qualification requires explicit loopback PostgreSQL');

const schema = `qc_mcp_oauth_${randomUUID().replaceAll('-', '')}`;
const owner = postgres(databaseUrl, { max: 1, prepare: false });
const app = postgres(databaseUrl, {
  max: 12,
  prepare: false,
  connection: { search_path: `${schema},pg_catalog` },
});
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://localhost:3118/callback';
const user = '20000000-0000-4000-8000-000000000001';
const org = '10000000-0000-4000-8000-000000000001';
let created = false;
let clientId = '';

beforeAll(async () => {
  await owner.unsafe(`create schema "${schema}"`);
  created = true;
  // Only the table and index statements: roles and row security are not what is qualified here.
  const ddl = readFileSync('supabase/migrations/20261121100000_mcp_oauth.sql', 'utf8')
    .split('alter table public.mcp_clients enable')[0]!
    .replaceAll('public.', `"${schema}".`);
  await owner.unsafe(ddl);
  // The one table of the hub's own schema this feature reads: a membership and when it began.
  await owner.unsafe(
    `create table "${schema}".organization_members(organization_id uuid, profile_id uuid, role text, created_at timestamptz not null default now())`,
  );
  boundary.db.mockReturnValue(drizzle(app));
});

afterAll(async () => {
  if (created) await owner.unsafe(`drop schema "${schema}" cascade`);
  await app.end();
  await owner.end();
});

beforeEach(async () => {
  await app`truncate mcp_credentials, mcp_connections, mcp_clients, organization_members cascade`;
  await app`insert into organization_members(organization_id, profile_id, role, created_at) values (${org}::uuid, ${user}::uuid, 'member', '2026-01-01T00:00:00.123Z')`;
  clientId = (await registerClient('Test app', [REDIRECT], null)).id;
});

const code = () =>
  createCode({
    clientId,
    userId: user,
    orgId: org,
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
  });
const exchange = (c: string) =>
  exchangeCode({ code: c, clientId, redirectUri: REDIRECT, verifier: VERIFIER });
const connections = () =>
  app<{ id: string; revoked_at: Date | null }[]>`select id, revoked_at from mcp_connections`;

describe('membership binding', () => {
  const open = async () => (await exchange(await code()))!;
  const readd = (at: string) =>
    app`update organization_members set created_at = ${at}::timestamptz where organization_id = ${org}::uuid`;

  it('the connection stores the membership instant it was approved under', async () => {
    await open();
    const [conn] = await app<
      { same: boolean }[]
    >`select member_since = (select created_at from organization_members) as same from mcp_connections`;
    expect(conn!.same).toBe(true);
  });

  it('an exchange without a membership is refused and creates nothing', async () => {
    await app`delete from organization_members`;
    expect(await exchange(await code())).toBeNull();
    expect(await connections()).toHaveLength(0);
  });

  it('a member removed and re-added (new created_at) cannot renew the old connection, which ends', async () => {
    const pair = await open();
    await app`delete from organization_members`;
    await app`insert into organization_members(organization_id, profile_id, role, created_at) values (${org}::uuid, ${user}::uuid, 'member', '2026-06-01T00:00:00.000Z')`;
    expect(await refresh({ token: pair.refresh_token, clientId })).toBeNull();
    expect((await connections())[0]!.revoked_at).not.toBeNull();
  });

  it('membershipSince reports the re-added membership instant, so the call path can compare it', async () => {
    await open();
    await readd('2026-06-01T00:00:00.000Z');
    expect((await membershipSince(org, user))!.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    await app`delete from organization_members`;
    expect(await membershipSince(org, user)).toBeNull();
  });
});

describe('code', () => {
  it('ten parallel exchanges of one code open exactly one connection', async () => {
    const c = await code();
    const results = await Promise.all(Array.from({ length: 10 }, () => exchange(c)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await connections()).toHaveLength(1);
  });

  it('a wrong verifier leaves the code spent (committed, not rolled back)', async () => {
    const c = await code();
    expect(
      await exchangeCode({ code: c, clientId, redirectUri: REDIRECT, verifier: 'x'.repeat(43) }),
    ).toBeNull();
    expect(await exchange(c)).toBeNull();
    expect(await connections()).toHaveLength(0);
  });

  it('presenting a spent code again ends the connection it opened', async () => {
    const c = await code();
    expect(await exchange(c)).not.toBeNull();
    expect(await exchange(c)).toBeNull();
    const [conn] = await connections();
    expect(conn!.revoked_at).not.toBeNull();
  });
});

describe('renewal', () => {
  const open = async () => (await exchange(await code()))!;
  const age = (seconds: number) =>
    app`update mcp_credentials set used_at = now() - make_interval(secs => ${seconds}) where kind = 'refresh'`;

  it('ten parallel renewals of one credential spend it once and allow at most one grace reissue', async () => {
    const pair = await open();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => refresh({ token: pair.refresh_token, clientId })),
    );
    const issued = results.filter(Boolean).length;
    expect(issued).toBeGreaterThanOrEqual(1);
    expect(issued).toBeLessThanOrEqual(2); // the spend, plus the single grace claim
    const [{ n }] = await app<
      { n: number }[]
    >`select count(*)::int as n from mcp_credentials where kind = 'refresh' and regranted_at is not null`;
    expect(n).toBeLessThanOrEqual(1);
  });

  it('a retry within 30 s gets a fresh pair and keeps the connection', async () => {
    const pair = await open();
    const first = await refresh({ token: pair.refresh_token, clientId });
    const retry = await refresh({ token: pair.refresh_token, clientId });
    expect(first).not.toBeNull();
    expect(retry).not.toBeNull();
    expect(retry!.refresh_token).not.toBe(first!.refresh_token);
    expect((await connections())[0]!.revoked_at).toBeNull();
  });

  it('a second grace reuse is refused and ends the connection', async () => {
    const pair = await open();
    await refresh({ token: pair.refresh_token, clientId });
    expect(await refresh({ token: pair.refresh_token, clientId })).not.toBeNull();
    expect(await refresh({ token: pair.refresh_token, clientId })).toBeNull();
    expect((await connections())[0]!.revoked_at).not.toBeNull();
  });

  it('reuse after the grace ends the connection', async () => {
    const pair = await open();
    await refresh({ token: pair.refresh_token, clientId });
    await age(60);
    expect(await refresh({ token: pair.refresh_token, clientId })).toBeNull();
    expect((await connections())[0]!.revoked_at).not.toBeNull();
  });

  it('another app presenting it burns nothing and ends nothing', async () => {
    const pair = await open();
    const other = (await registerClient('Other', [REDIRECT], null)).id;
    expect(await refresh({ token: pair.refresh_token, clientId: other })).toBeNull();
    expect(await refresh({ token: pair.refresh_token, clientId })).not.toBeNull();
  });

  it('an ended connection cannot renew', async () => {
    const pair = await open();
    await app`update mcp_connections set revoked_at = now()`;
    expect(await refresh({ token: pair.refresh_token, clientId })).toBeNull();
  });

  it('a connection approved over 180 days ago cannot renew', async () => {
    const pair = await open();
    await app`update mcp_connections set approved_at = now() - interval '181 days'`;
    expect(await refresh({ token: pair.refresh_token, clientId })).toBeNull();
  });
});
