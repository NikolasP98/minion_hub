import { PGlite } from '@electric-sql/pglite';
import { SignJWT, jwtVerify } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  query: null as unknown,
  token: '',
  verify: null as unknown,
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => fixture.query }));
vi.mock('$server/db/client', () => ({ getDb: () => ({ synthetic: true }) }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn() }));
vi.mock('$server/auth/crypto', () => ({ decryptToken: vi.fn() }));
vi.mock('$server/supabase', () => ({
  supabaseServer: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: fixture.token } }, error: null }),
      getClaims: (token: string) => (fixture.verify as (token: string) => Promise<unknown>)(token),
    },
  }),
  supabaseAdmin: vi.fn(),
}));

import { resolveIdentity } from './resolve-identity';
import { POST as selectOrganization } from '../../routes/api/active-org/+server';

const db = new PGlite();
const key = new Uint8Array(32).fill(17);
const userId = '00000000-0000-4000-8000-000000000001';
const orgA = '00000000-0000-4000-8000-00000000000a';
const orgB = '00000000-0000-4000-8000-00000000000b';
let verificationTime: Date;
let directoryUnavailable = false;

function event(options: { org?: string | null; method?: string; appPage?: boolean } = {}) {
  const cookieValues = new Map<string, string>();
  if (options.org !== null) cookieValues.set('active_org', options.org ?? orgA);
  cookieValues.set('sb-project-auth-token', fixture.token);
  const url = new URL(
    options.appPage ? 'https://hub.test/home' : 'https://hub.test/api/crm/contacts',
  );
  const deleted: string[] = [];
  return {
    event: {
      url,
      route: { id: options.appPage ? '/(app)/home' : '/api/crm/contacts' },
      request: new Request(url, { method: options.method ?? 'POST' }),
      cookies: {
        get: (name: string) => cookieValues.get(name),
        getAll: () => Array.from(cookieValues, ([name, value]) => ({ name, value })),
        delete: (name: string) => {
          cookieValues.delete(name);
          deleted.push(name);
        },
      },
    } as unknown as Parameters<typeof resolveIdentity>[0],
    deleted,
  };
}

beforeAll(async () => {
  await db.exec(`
    create table profiles (id uuid primary key, email text, display_name text,
      role text, avatar_url text, created_at text, username text);
    create table organizations (id uuid primary key, name text, slug text, kind text);
    create table organization_members (profile_id uuid, organization_id uuid, role text);
  `);
  fixture.query = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (directoryUnavailable) throw new Error('directory unavailable');
    const text = parts.reduce(
      (result, part, index) => result + (index ? `$${index}` : '') + part,
      '',
    );
    return (await db.query(text, values)).rows;
  };
  fixture.verify = async (token: string) => {
    try {
      const { payload } = await jwtVerify(token, key, { currentDate: verificationTime });
      return { data: { claims: payload }, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };
});
beforeEach(async () => {
  directoryUnavailable = false;
  verificationTime = new Date();
  fixture.token = await new SignJWT({ email: 'reader@fixture.test' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('1m')
    .sign(key);
  await db.exec('truncate profiles, organizations, organization_members');
  await db.query("insert into profiles (id,email,role) values ($1,'reader@fixture.test','admin')", [
    userId,
  ]);
  await db.query(
    "insert into organizations values ($1,'Alpha',null,'business'),($2,'Beta',null,'personal')",
    [orgA, orgB],
  );
  await db.query("insert into organization_members values ($1,$2,'owner'),($1,$3,'member')", [
    userId,
    orgA,
    orgB,
  ]);
});
afterAll(() => db.close());

describe('request authority through verified claims and canonical PostgreSQL', () => {
  it('sees membership removal on the next request with the identical token and selection', async () => {
    const request = event();
    expect((await resolveIdentity(request.event)).locals.orgId).toBe(orgA);
    await db.query('delete from organization_members where organization_id=$1', [orgA]);
    const next = await resolveIdentity(request.event);
    expect(next.locals.user?.id).toBe(userId);
    expect(next.locals.orgId).toBeUndefined();
    expect(next.locals.tenantCtx).toBeUndefined();
    expect(request.deleted).toEqual([]);
  });

  it('sees a platform-role downgrade without waiting for a cache TTL', async () => {
    const request = event();
    expect((await resolveIdentity(request.event)).locals.user?.role).toBe('admin');
    await db.query("update profiles set role='user' where id=$1", [userId]);
    expect((await resolveIdentity(request.event)).locals.user?.role).toBe('user');
  });

  it('rejects token expiry after a successful request and clears only auth cookies', async () => {
    const request = event();
    expect((await resolveIdentity(request.event)).locals.user?.id).toBe(userId);
    verificationTime = new Date(verificationTime.getTime() + 61_000);
    expect(await resolveIdentity(request.event)).toEqual({ locals: {}, bypassGate: false });
    expect(request.deleted).toEqual(['sb-project-auth-token']);
  });

  it('rejects a supplied token signed with another key', async () => {
    fixture.token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setExpirationTime('1m')
      .sign(new Uint8Array(32).fill(99));
    expect(await resolveIdentity(event().event)).toEqual({ locals: {}, bypassGate: false });
  });

  it('preserves authentication cookies and fails when the canonical directory is unavailable', async () => {
    const request = event();
    await resolveIdentity(request.event);
    directoryUnavailable = true;
    await expect(resolveIdentity(request.event)).rejects.toThrow('directory unavailable');
    expect(request.deleted).toEqual([]);
  });

  it('honors current explicit membership and defaults only without a selection', async () => {
    expect((await resolveIdentity(event({ org: orgB }).event)).locals).toMatchObject({
      orgId: orgB,
      orgKind: 'personal',
    });
    expect((await resolveIdentity(event({ org: null }).event)).locals.orgId).toBe(orgA);
  });

  it.each(['GET', 'POST', 'PATCH', 'DELETE'])(
    'never substitutes another tenant on an API %s',
    async (method) => {
      await db.query('delete from organization_members where organization_id=$1', [orgA]);
      const request = event({ method });
      expect((await resolveIdentity(request.event)).locals.tenantCtx).toBeUndefined();
      expect(request.deleted).toEqual([]);
    },
  );

  it.each(['GET', 'HEAD'])(
    'recovers a stale selection only during app-page %s navigation',
    async (method) => {
      await db.query('delete from organization_members where organization_id=$1', [orgA]);
      const request = event({ method, appPage: true });
      expect((await resolveIdentity(request.event)).locals).toMatchObject({
        orgId: orgB,
        orgKind: 'personal',
      });
      expect(request.deleted).toEqual(['active_org']);
    },
  );

  it('treats an explicitly empty organization cookie as unavailable for APIs', async () => {
    const request = event({ org: '' });
    expect((await resolveIdentity(request.event)).locals.tenantCtx).toBeUndefined();
    expect(request.deleted).toEqual([]);
  });

  it('recovers and clears an empty selection during safe app navigation', async () => {
    const request = event({ org: '', appPage: true, method: 'GET' });
    expect((await resolveIdentity(request.event)).locals.orgId).toBe(orgA);
    expect(request.deleted).toEqual(['active_org']);
  });

  it('does not reroute a SvelteKit form action into another organization', async () => {
    await db.query('delete from organization_members where organization_id=$1', [orgA]);
    const request = event({ method: 'POST', appPage: true });
    expect((await resolveIdentity(request.event)).locals.tenantCtx).toBeUndefined();
    expect(request.deleted).toEqual([]);
  });

  it('retains the authenticated user without inventing a tenant when all memberships are removed', async () => {
    await db.exec('delete from organization_members');
    const next = await resolveIdentity(event({ method: 'GET', appPage: true }).event);
    expect(next.locals.user?.id).toBe(userId);
    expect(next.locals.tenantCtx).toBeUndefined();
  });

  it('lets a user with a revoked selection explicitly switch only to a current membership', async () => {
    await db.query('delete from organization_members where organization_id=$1', [orgA]);
    const request = event();
    const identity = await resolveIdentity(request.event);
    expect(identity.locals.tenantCtx).toBeUndefined();
    const set = vi.fn();
    const selection = (orgId: string) =>
      ({
        ...request.event,
        locals: identity.locals,
        request: new Request('https://hub.test/api/active-org', {
          method: 'POST',
          body: JSON.stringify({ orgId }),
        }),
        cookies: { ...request.event.cookies, set },
      }) as Parameters<typeof selectOrganization>[0];
    await expect(selectOrganization(selection(orgA))).rejects.toMatchObject({ status: 403 });
    expect(set).not.toHaveBeenCalled();
    expect((await selectOrganization(selection(orgB))).status).toBe(200);
    expect(set).toHaveBeenCalledExactlyOnceWith(
      'active_org',
      orgB,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  it('rejects organization selection without a canonical principal', async () => {
    const request = event();
    const selection = {
      ...request.event,
      locals: { user: { id: 'legacy', email: 'legacy@fixture.test', role: 'admin' } },
      request: new Request('https://hub.test/api/active-org', {
        method: 'POST',
        body: JSON.stringify({ orgId: orgA }),
      }),
    } as Parameters<typeof selectOrganization>[0];
    await expect(selectOrganization(selection)).rejects.toMatchObject({ status: 403 });
  });
});
