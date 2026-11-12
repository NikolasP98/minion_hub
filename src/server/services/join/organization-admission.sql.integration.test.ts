import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ARRAY_TYPES } from '$server/db/pg-pool';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { validateMarkedLoopbackPostgres } from '../../../../scripts/qc/loopback-postgres';

const boundary = vi.hoisted(() => ({ pool: vi.fn(), invalidate: vi.fn() }));
vi.mock('$server/db/pg-pool', async (original) => ({
  ...(await original<typeof import('$server/db/pg-pool')>()),
  getPgClient: boundary.pool,
}));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => {
    throw new Error('Unexpected PostgREST access in native admission');
  },
}));
vi.mock('$lib/plugins/icon-map', () => ({ PLUGIN_ICON_MAP: {} }));
// This fixture has no custom navigation and qualifies the real capability/grant
// containment plus PostgreSQL transactions. Native/custom page containment has
// its dedicated role-simulation-policy tests and browser qualification.
vi.mock('../simulation-navigation', () => ({
  simulationRouteAllowed: () => true,
  simulationPageAllowed: () => true,
}));
import { MODULES, buildCapabilities } from '../rbac.service';
import { runWithEffectiveAuthority } from '$server/auth/effective-authority';
import { admitLegacyMembership } from './profile-admission';
import {
  mintOrganizationInvite,
  consumeOrganizationInvite,
  approveOrganizationRequest,
  type AdmissionTables,
} from './organization-admission';

const schema = `role_admission_${randomUUID().replaceAll('-', '')}`;
const tables: AdmissionTables = Object.fromEntries(
  Object.entries({
    organizations: 'organizations',
    roles: 'org_roles',
    members: 'organization_members',
    assignments: 'member_roles',
    rules: 'permission_rules',
    profiles: 'profiles',
    nav: 'app_nav_config',
    links: 'join_link',
    requests: 'join_request',
    audit: 'doc_audit_log',
  }).map(([key, value]) => [key, `${schema}.${value}`]),
) as unknown as AdmissionTables;
const org = randomUUID(),
  otherOrg = randomUUID(),
  grantor = randomUUID(),
  profile = randomUUID();
const admin = 'custom-administrator',
  reader = 'custom-reader';
let db: ReturnType<typeof postgres>;
const user = () => ({
  id: 'legacy-user',
  supabaseId: profile,
  email: 'applicant@example.test',
  displayName: 'Applicant',
});
const mint = (role?: string, maxUses?: number) =>
  mintOrganizationInvite(
    { organizationId: org, role, grantorProfileId: grantor, createdBy: 'grantor-user', maxUses },
    tables,
  );
beforeAll(async () => {
  const url = validateMarkedLoopbackPostgres(
    process.env.HUB_TEST_DB_URL,
    process.env.REQUIRE_ORG_ROLES_POSTGRES,
    'REQUIRE_ORG_ROLES_POSTGRES',
  );
  db = postgres(url.href, {
    max: 6,
    connect_timeout: 3,
    prepare: false,
    fetch_types: false,
    types: ARRAY_TYPES as unknown as Record<string, postgres.PostgresType>,
  });
  // Match the real shared production client after Drizzle changes JSON serializers.
  drizzle(db);
  boundary.pool.mockReturnValue(db);
  await db`create schema ${db(schema)}`;
  await db`create table ${db(tables.organizations)} (id uuid primary key,status text,role_model text,default_role_key text)`;
  await db`create table ${db(tables.roles)} (org_id text,key text,rank int,primary key(org_id,key))`;
  await db`create table ${db(tables.profiles)} (id uuid primary key,role text,deletion_pending boolean default false)`;
  await db`create table ${db(tables.members)} (organization_id uuid,profile_id uuid,role text,primary key(organization_id,profile_id))`;
  await db`create table ${db(tables.assignments)} (org_id uuid,profile_id uuid,role_key text,granted_by uuid,primary key(org_id,profile_id,role_key))`;
  await db`create table ${db(tables.rules)} (org_id uuid,role_key text,module text,can_view boolean,
    can_create boolean,can_edit boolean,can_delete boolean,can_export boolean,can_manage boolean,
    if_owner boolean,field_level int,primary key(org_id,role_key,module))`;
  await db`create table ${db(tables.nav)} (org_id text primary key,value jsonb)`;
  await db`create table ${db(tables.links)} (id uuid primary key default gen_random_uuid(),token text unique,
    organization_id text,role text,created_by text,expires_at timestamptz,max_uses int,uses_count int default 0,
    revoked boolean default false,role_revision text,grantor_profile_id uuid)`;
  await db`create table ${db(tables.requests)} (id uuid primary key,supabase_id uuid,status text,
    organization_id text,reviewed_by text,reviewed_at timestamptz)`;
  await db`create table ${db(tables.audit)} (id uuid primary key,org_id text,ref_type text,ref_id uuid,
    actor_id uuid,op text,changes jsonb)`;
});
beforeEach(async () => {
  boundary.pool.mockReturnValue(db);
  for (const table of Object.values(tables)) await db`truncate ${db(table)}`;
  await db`insert into ${db(tables.organizations)} values(${org},'active','organization',${admin}),
    (${otherOrg},'active','organization',${admin})`;
  await db`insert into ${db(tables.profiles)} values(${grantor},'user',false),(${profile},'user',false)`;
  await db`insert into ${db(tables.roles)} values(${org},${admin},80),(${org},${reader},10),
    (${otherOrg},'custom-foreign',80)`;
  await db`insert into ${db(tables.members)} values(${org},${grantor},'owner')`;
  await db`insert into ${db(tables.assignments)} values(${org},${grantor},${admin},${grantor})`;
  for (const role of [admin, reader])
    for (const module of MODULES) {
      const full = role === admin,
        view = full || module === 'crm';
      await db`insert into ${db(tables.rules)} values(${org},${role},${module},${view},${full},${full},
      ${full},${full},${full},false,1)`;
    }
});
afterAll(async () => {
  if (db) {
    await db`drop schema ${db(schema)} cascade`;
    await db.end();
  }
});

describe('organization-model transactional admission on PostgreSQL', () => {
  it('completes legacy profile-fenced admission with a one-connection pool and retains legacy role semantics', async () => {
    const url = process.env.HUB_TEST_DB_URL!;
    const single = postgres(url, { max: 1, prepare: false, connect_timeout: 3 });
    boundary.pool.mockReturnValue(single);
    try {
      await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
      await admitLegacyMembership(org, profile, 'staff', tables);
      const [member] = await db`select role from ${db(tables.members)} where profile_id=${profile}`;
      expect(member.role).toBe('member');
      await admitLegacyMembership(org, profile, 'admin', tables);
      const [updated] =
        await db`select role from ${db(tables.members)} where profile_id=${profile}`;
      expect(updated.role).toBe('admin');
      expect(
        await db`select role_key from ${db(tables.assignments)} where profile_id=${profile} order by role_key`,
      ).toEqual([
        expect.objectContaining({ role_key: 'admin' }),
        expect.objectContaining({ role_key: 'staff' }),
      ]);
    } finally {
      boundary.pool.mockReturnValue(db);
      await single.end({ timeout: 2 });
    }
  });
  it('rejects a pending-deletion legacy admission before either membership write', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    await db`update ${db(tables.profiles)} set deletion_pending=true where id=${profile}`;
    await expect(admitLegacyMembership(org, profile, 'staff', tables)).rejects.toMatchObject({
      status: 403,
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(
      await db`select * from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toHaveLength(0);
  });
  it('rejects pending-deletion targets without granting membership or consuming an invite', async () => {
    const link = await mint(reader);
    await db`update ${db(tables.profiles)} set deletion_pending=true where id=${profile}`;
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 403,
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    const [stored] = await db`select uses_count from ${db(tables.links)} where id=${link.id}`;
    expect(stored.uses_count).toBe(0);
  });
  it('rejects a pending-deletion grantor when minting or redeeming their invite', async () => {
    const link = await mint(reader);
    await db`update ${db(tables.profiles)} set deletion_pending=true where id=${grantor}`;
    await expect(mint(reader)).rejects.toMatchObject({ status: 403 });
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 403,
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
  });
  it('keeps requests pending when their target profile is fenced for deletion', async () => {
    const id = randomUUID();
    await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${org},null,null)`;
    await db`update ${db(tables.profiles)} set deletion_pending=true where id=${profile}`;
    await expect(
      approveOrganizationRequest(
        id,
        { organizationId: org, reviewerId: 'reviewer-user', reviewerProfileId: grantor },
        tables,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const [request] = await db`select status from ${db(tables.requests)} where id=${id}`;
    expect(request.status).toBe('pending');
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
  });
  it('intersects invite grant authority with the active simulated role', async () => {
    await expect(
      runWithEffectiveAuthority(
        {
          orgId: org,
          profileId: grantor,
          roleKey: reader,
          generation: randomUUID(),
          rank: 10,
          invalid: false,
          capabilities: buildCapabilities([], []),
        },
        () => mint(admin),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('freezes the default local role when minting and does not adopt a later default', async () => {
    const link = await mint();
    await db`update ${db(tables.organizations)} set default_role_key=${reader} where id=${org}`;
    await consumeOrganizationInvite(link.token, user(), tables);
    const [assigned] =
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`;
    expect(assigned.role_key).toBe(admin);
  });
  it('admits the selected local role and consumes exactly one use atomically', async () => {
    const link = await mint(reader, 1);
    await consumeOrganizationInvite(link.token, user(), tables);
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([expect.objectContaining({ role_key: reader })]);
    const [stored] = await db`select uses_count from ${db(tables.links)} where id=${link.id}`;
    expect(stored.uses_count).toBe(1);
    const [audit] =
      await db`select jsonb_typeof(changes) as kind,changes->0->>'field' as field,changes->0->>'new' as role from ${db(tables.audit)}`;
    expect(audit).toEqual({ kind: 'array', field: 'role', role: reader });
  });
  it('retains raw JSON navigation section denials on the Drizzle-initialized shared pool', async () => {
    const nav = {
      version: 1,
      sections: [{ id: 'abc123', slug: 'marketing', label: 'Marketing', pages: [] }],
      builtinSections: {},
      builtin: {},
    };
    await db`insert into ${db(tables.nav)} values(${org},${JSON.stringify(nav)}::text::jsonb)`;
    await db`insert into ${db(tables.rules)} values(${org},${admin},'section:abc123',false,false,false,false,false,false,false,0)`;
    const [stored] = await db`select value from ${db(tables.nav)} where org_id=${org}`;
    expect(stored.value).toEqual(nav);
    await expect(mint(reader)).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('replaying an invite never promotes an existing member or consumes another use', async () => {
    const restricted = await mint(reader);
    await consumeOrganizationInvite(restricted.token, user(), tables);
    const elevated = await mint(admin, 1);
    await consumeOrganizationInvite(elevated.token, user(), tables);
    await consumeOrganizationInvite(restricted.token, user(), tables);
    const rows =
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`;
    expect(rows).toEqual([expect.objectContaining({ role_key: reader })]);
    const [stored] = await db`select uses_count from ${db(tables.links)} where id=${elevated.id}`;
    expect(stored.uses_count).toBe(0);
  });
  it('serializes concurrent redemptions so a one-use link admits only one new member', async () => {
    const second = randomUUID();
    await db`insert into ${db(tables.profiles)} values(${second},'user',false)`;
    const link = await mint(reader, 1);
    const results = await Promise.allSettled([
      consumeOrganizationInvite(link.token, user(), tables),
      consumeOrganizationInvite(link.token, { ...user(), supabaseId: second }, tables),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [count] =
      await db`select count(*)::int as n from ${db(tables.members)} where profile_id in (${profile},${second})`;
    expect(count.n).toBe(1);
  });
  it('rejects an invite whose role permissions changed after minting', async () => {
    const link = await mint(reader);
    await db`update ${db(tables.rules)} set can_edit=true where org_id=${org} and role_key=${reader} and module='crm'`;
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 409,
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
  });
  it('rejects an invite after the original grantor loses grant authority', async () => {
    const link = await mint(reader);
    await db`update ${db(tables.assignments)} set role_key=${reader} where profile_id=${grantor}`;
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 403,
    });
    const [stored] = await db`select uses_count from ${db(tables.links)} where id=${link.id}`;
    expect(stored.uses_count).toBe(0);
  });
  it('rejects foreign and built-in role keys without minting an invite', async () => {
    for (const role of ['custom-foreign', 'owner', 'admin'])
      await expect(mint(role)).rejects.toMatchObject({ status: 400 });
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('accepts a future-dated invite when the mixed pool returns timestamp strings', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const link = await mintOrganizationInvite(
      {
        organizationId: org,
        role: reader,
        grantorProfileId: grantor,
        createdBy: 'grantor-user',
        expiresAt,
        maxUses: 1,
      },
      tables,
    );
    const [raw] = await db`select expires_at from ${db(tables.links)} where id=${link.id}`;
    expect(typeof raw.expires_at).toBe('string');
    await expect(consumeOrganizationInvite(link.token, user(), tables)).resolves.toEqual({
      organizationId: org,
    });
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: reader }]);
    const [stored] = await db`select uses_count from ${db(tables.links)} where id=${link.id}`;
    expect(stored.uses_count).toBe(1);
  });
  it('rejects revoked and expired links without creating membership or consuming use', async () => {
    for (const patch of [{ revoked: true }, { expires_at: '2020-01-01T00:00:00Z' }]) {
      const link = await mint(reader);
      await db`update ${db(tables.links)} set ${db(patch)} where id=${link.id}`;
      await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
  });
  it('rolls back membership, role and use when audit insertion fails', async () => {
    const link = await mint(reader);
    await db`alter table ${db(tables.audit)} add constraint reject_audit check(false) not valid`;
    try {
      await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toThrow();
      expect(
        await db`select * from ${db(tables.members)} where profile_id=${profile}`,
      ).toHaveLength(0);
      expect(
        await db`select * from ${db(tables.assignments)} where profile_id=${profile}`,
      ).toHaveLength(0);
      const [stored] = await db`select uses_count from ${db(tables.links)} where id=${link.id}`;
      expect(stored.uses_count).toBe(0);
    } finally {
      await db`alter table ${db(tables.audit)} drop constraint reject_audit`;
    }
  });
  it('approves a pending request atomically using the current default local role', async () => {
    const id = randomUUID();
    await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${org},null,null)`;
    await approveOrganizationRequest(
      id,
      { organizationId: org, reviewerId: 'reviewer-user', reviewerProfileId: grantor },
      tables,
    );
    const [request] = await db`select status from ${db(tables.requests)} where id=${id}`;
    expect(request.status).toBe('approved');
    const [assigned] =
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`;
    expect(assigned.role_key).toBe(admin);
  });
  it('does not resolve a request from another organization', async () => {
    const id = randomUUID();
    await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${otherOrg},null,null)`;
    await expect(
      approveOrganizationRequest(
        id,
        { organizationId: org, reviewerId: 'reviewer-user', reviewerProfileId: grantor },
        tables,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const [request] = await db`select status from ${db(tables.requests)} where id=${id}`;
    expect(request.status).toBe('pending');
  });
  it('leaves a pending request unresolved when membership admission rolls back', async () => {
    const id = randomUUID();
    await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${org},null,null)`;
    await db`alter table ${db(tables.audit)} add constraint reject_audit check(false) not valid`;
    try {
      await expect(
        approveOrganizationRequest(
          id,
          { organizationId: org, reviewerId: 'reviewer-user', reviewerProfileId: grantor },
          tables,
        ),
      ).rejects.toThrow();
      const [request] = await db`select status from ${db(tables.requests)} where id=${id}`;
      expect(request.status).toBe('pending');
      expect(
        await db`select * from ${db(tables.members)} where profile_id=${profile}`,
      ).toHaveLength(0);
      expect(
        await db`select * from ${db(tables.assignments)} where profile_id=${profile}`,
      ).toHaveLength(0);
    } finally {
      await db`alter table ${db(tables.audit)} drop constraint reject_audit`;
    }
  });
});
