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
import { MODULES, buildCapabilities, type CapabilityOverrideRow } from '../rbac.service';
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
    systemRoles: 'permission_roles',
    members: 'organization_members',
    assignments: 'member_roles',
    rules: 'permission_rules',
    profiles: 'profiles',
    nav: 'app_nav_config',
    links: 'join_link',
    requests: 'join_request',
    audit: 'doc_audit_log',
    brains: 'brains',
    brainAccess: 'brain_access',
    personalAgents: 'personal_agents',
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
    connection: { application_name: schema },
  });
  // Match the real shared production client after Drizzle changes JSON serializers.
  drizzle(db);
  boundary.pool.mockReturnValue(db);
  await db`create schema ${db(schema)}`;
  await db`create table ${db(tables.organizations)} (id uuid primary key,status text,role_model text,default_role_key text)`;
  await db`create table ${db(tables.roles)} (org_id text,key text,rank int,primary key(org_id,key))`;
  await db`create table ${db(tables.systemRoles)} (key text primary key,rank int)`;
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
  await db`create table ${db(tables.brains)} (id uuid primary key,org_id text,created_by text,visibility text)`;
  await db`create table ${db(tables.brainAccess)} (brain_id uuid,org_id text,principal_type text,principal_id text,level text,primary key(brain_id,principal_type,principal_id))`;
  await db`create table ${db(tables.personalAgents)} (profile_id uuid,agent_id text)`;
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
  await db`insert into ${db(tables.systemRoles)} values('owner',100),('admin',80),('manager',60),('staff',40),('viewer',20)`;
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
  it('rejects reactivation of private Brain read through the recipient persisted personal agent', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`update ${db(tables.rules)} set can_view=true where role_key=${reader} and module='brains'`;
    await db`insert into ${db(tables.personalAgents)} values(${profile},'recipient-agent')`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'agent','recipient-agent','read')`;
    const link = await mint(reader, 1);
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 403,
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 0 },
    ]);
  });
  it('allows verified owned-agent private Brain read only when the grantor holds matching asset access', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`update ${db(tables.rules)} set can_view=true where role_key=${reader} and module='brains'`;
    await db`insert into ${db(tables.personalAgents)} values(${profile},'Recipient-Agent')`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'agent','recipient-agent','read'),(${brain},${org},'user',${grantor},'read')`;
    const link = await mint(reader, 1);
    await consumeOrganizationInvite(link.token, user(), tables);
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: reader }]);
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 1 },
    ]);
  });
  it('does not attribute unknown or foreign-owned personal-agent ACLs to an unrelated admission recipient', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`update ${db(tables.rules)} set can_view=true where role_key=${reader} and module='brains'`;
    await db`insert into ${db(tables.personalAgents)} values(${grantor},'foreign-owned-agent')`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'agent','foreign-owned-agent','read'),(${brain},${org},'agent','unknown-agent','read')`;
    const link = await mint(reader, 1);
    await consumeOrganizationInvite(link.token, user(), tables);
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: reader }]);
  });
  it('rejects ambiguous case-folded persisted personal-agent ownership before minting', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`insert into ${db(tables.personalAgents)} values(${profile},'Recipient-Agent'),(${grantor},'recipient-agent')`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'agent','recipient-agent','read')`;
    await expect(mint(reader)).rejects.toMatchObject({ status: 503 });
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('does not widen grantor authority using the grantor own personal-agent Brain ACL', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`update ${db(tables.rules)} set can_view=true where role_key=${reader} and module='brains'`;
    await db`insert into ${db(tables.personalAgents)} values(${profile},'recipient-agent'),(${grantor},'grantor-agent')`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'agent','recipient-agent','read'),(${brain},${org},'agent','grantor-agent','read')`;
    const link = await mint(reader, 1);
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 403,
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 0 },
    ]);
  });
  it('rejects private Brain role ACL grants beyond the actor in both role models', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    for (const [model, selected] of [
      ['organization', reader],
      ['legacy', 'staff'],
    ] as const) {
      await db`update ${db(tables.organizations)} set role_model=${model},default_role_key=${model === 'legacy' ? null : admin} where id=${org}`;
      await db`insert into ${db(tables.rules)} values(${org},${selected},'brains',true,false,true,false,false,false,false,1)
        on conflict(org_id,role_key,module) do update set can_view=true,can_edit=true,can_manage=false,field_level=1`;
      await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'role',${selected},'write')`;
      await expect(mint(selected)).rejects.toMatchObject({ status: 403 });
    }
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('rejects legacy Admin private-Brain bypass even for an equal-rank full-module grantor', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    // No existing assets: the legacy role name also grants future private Brains.
    await expect(mint('admin')).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('rejects private Brain user ACLs reactivated by admission in both role models', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'user',${profile},'write')`;
    for (const [model, selected] of [
      ['organization', reader],
      ['legacy', 'staff'],
    ] as const) {
      await db`update ${db(tables.organizations)} set role_model=${model},default_role_key=${model === 'legacy' ? null : admin} where id=${org}`;
      await db`insert into ${db(tables.rules)} values(${org},${selected},'brains',true,false,true,false,false,false,false,1)
        on conflict(org_id,role_key,module) do update set can_view=true,can_edit=true,can_manage=false,field_level=1`;
      const link = await mint(selected, 1);
      await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
        status: 403,
      });
      expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
        { uses_count: 0 },
      ]);
    }
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
  });
  it('rejects private Brain creator rights reactivated by approval or direct legacy admission without grantor access', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},${profile},'private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    for (const [model, selected] of [
      ['organization', reader],
      ['legacy', 'staff'],
    ] as const) {
      await db`update ${db(tables.organizations)} set role_model=${model},default_role_key=${model === 'legacy' ? null : admin} where id=${org}`;
      await db`insert into ${db(tables.rules)} values(${org},${selected},'brains',true,false,true,false,false,false,false,1)
        on conflict(org_id,role_key,module) do update set can_view=true,can_edit=true,can_manage=false,field_level=1`;
      const id = randomUUID();
      await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${org},null,null)`;
      await expect(
        approveOrganizationRequest(
          id,
          {
            organizationId: org,
            role: selected,
            reviewerId: 'reviewer',
            reviewerProfileId: grantor,
          },
          tables,
        ),
      ).rejects.toMatchObject({ status: 403 });
      if (model === 'legacy')
        await expect(
          admitLegacyMembership(org, profile, selected, grantor, tables),
        ).rejects.toMatchObject({ status: 403 });
      expect(await db`select status from ${db(tables.requests)} where id=${id}`).toEqual([
        { status: 'pending' },
      ]);
    }
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(await db`select * from ${db(tables.audit)}`).toHaveLength(0);
  });
  it('allows recipient-specific private Brain read rights when the grantor holds the same asset access', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`update ${db(tables.rules)} set can_view=true where role_key=${reader} and module='brains'`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'user',${profile},'read'),(${brain},${org},'user',${grantor},'read')`;
    const link = await mint(reader, 1);
    await consumeOrganizationInvite(link.token, user(), tables);
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: reader }]);
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 1 },
    ]);
  });
  it('replaces inactive legacy Admin assignments with exactly the verified Viewer role on re-admission', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    await db`update ${db(tables.assignments)} set role_key='admin' where profile_id=${grantor}`;
    await db`insert into ${db(tables.assignments)} values(${org},${profile},'admin',${grantor})`;
    const link = await mint('viewer', 1);
    await consumeOrganizationInvite(link.token, user(), tables);
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: 'viewer' }]);
    expect(await db`select role from ${db(tables.members)} where profile_id=${profile}`).toEqual([
      { role: 'member' },
    ]);
    const [audit] = await db`select changes from ${db(tables.audit)}`;
    expect(audit.changes).toContainEqual({
      field: 'inactive_role_assignments',
      old: ['admin'],
      new: [],
    });
  });
  it('allows private Brain role grants from the asset creator in both role models', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},${grantor},'private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    for (const [model, selected] of [
      ['organization', reader],
      ['legacy', 'staff'],
    ] as const) {
      await db`delete from ${db(tables.members)} where profile_id=${profile}`;
      await db`delete from ${db(tables.assignments)} where profile_id=${profile}`;
      await db`update ${db(tables.organizations)} set role_model=${model},default_role_key=${model === 'legacy' ? null : admin} where id=${org}`;
      await db`insert into ${db(tables.rules)} values(${org},${selected},'brains',true,false,true,false,false,false,false,1)
        on conflict(org_id,role_key,module) do update set can_view=true,can_edit=true,can_manage=false,field_level=1`;
      await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'role',${selected},'write')`;
      const link = await mint(selected, 1);
      await consumeOrganizationInvite(link.token, user(), tables);
      expect(
        await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
      ).toEqual([{ role_key: selected }]);
      expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
        { uses_count: 1 },
      ]);
    }
  });
  it('rejects selected private Brain ACL expansion after minting even when the grantor owns the new asset', async () => {
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`update ${db(tables.rules)} set can_view=true,can_edit=true where role_key=${reader} and module='brains'`;
    const link = await mint(reader, 1);
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},${grantor},'private')`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'role',${reader},'write')`;
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 409,
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 0 },
    ]);
  });
  it('intersects private Brain grants with the current simulated object authority', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    await db`update ${db(tables.assignments)} set role_key='admin' where profile_id=${grantor}`;
    await db`insert into ${db(tables.rules)} values(${org},'staff','brains',true,false,true,false,false,false,false,1)`;
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'role','staff','write')`;
    const rules = await db<CapabilityOverrideRow[]>`select * from ${db(tables.rules)}`;
    await expect(
      runWithEffectiveAuthority(
        {
          orgId: org,
          profileId: grantor,
          roleKey: admin,
          generation: randomUUID(),
          rank: 80,
          invalid: false,
          capabilities: buildCapabilities([admin], rules),
        },
        () => mint('staff'),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('serializes private Brain access revocation before redemption and keeps use and approval unchanged', async () => {
    const brain = randomUUID();
    await db`insert into ${db(tables.brains)} values(${brain},${org},'other-owner','private')`;
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='brains'`;
    await db`update ${db(tables.rules)} set can_view=true,can_edit=true where role_key=${reader} and module='brains'`;
    await db`insert into ${db(tables.brainAccess)} values(${brain},${org},'user',${grantor},'write'),(${brain},${org},'role',${reader},'write')`;
    const link = await mint(reader, 1);
    const id = randomUUID();
    await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${org},null,null)`;
    let beginRedemption!: () => void;
    const gate = new Promise<void>((resolve) => {
      beginRedemption = resolve;
    });
    let releaseRevocation!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const revoke = db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${org},112))`;
      await tx`delete from ${tx(tables.brainAccess)} where principal_type='user' and principal_id=${grantor}`;
      beginRedemption();
      await release;
    });
    await gate;
    const redemption = Promise.allSettled([consumeOrganizationInvite(link.token, user(), tables)]);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [activity] = await db<{ waiting: boolean }[]>`select exists(
          select 1 from pg_stat_activity where application_name=${schema} and wait_event='advisory'
        ) as waiting`;
        if (activity.waiting) {
          waiting = true;
          break;
        }
        await db`select pg_sleep(0.01)`;
      }
      expect(waiting).toBe(true);
    } finally {
      releaseRevocation();
      await revoke;
    }
    expect(await redemption).toMatchObject([{ status: 'rejected', reason: { status: 403 } }]);
    await expect(
      approveOrganizationRequest(
        id,
        { organizationId: org, role: reader, reviewerId: 'reviewer', reviewerProfileId: grantor },
        tables,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 0 },
    ]);
    expect(await db`select status from ${db(tables.requests)} where id=${id}`).toEqual([
      { status: 'pending' },
    ]);
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(await db`select * from ${db(tables.audit)}`).toHaveLength(0);
  });
  it('admits a permitted legacy built-in role with verified grantor provenance and one atomic use', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    await db`update ${db(tables.assignments)} set role_key='admin' where profile_id=${grantor}`;
    const link = await mint('admin', 1);
    const [minted] =
      await db`select grantor_profile_id,role_revision from ${db(tables.links)} where id=${link.id}`;
    expect(minted.grantor_profile_id).toBe(grantor);
    expect(minted.role_revision).toMatch(/^[a-f0-9]{64}$/);
    await consumeOrganizationInvite(link.token, user(), tables);
    expect(await db`select role from ${db(tables.members)} where profile_id=${profile}`).toEqual([
      { role: 'admin' },
    ]);
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: 'admin' }]);
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 1 },
    ]);
  });
  it('rejects a legacy invitation without recorded grantor authority while preserving existing-member replay', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    await db`insert into ${db(tables.links)} (token,organization_id,role,uses_count) values('legacy-unverified',${org},'admin',0)`;
    await expect(
      consumeOrganizationInvite('legacy-unverified', user(), tables),
    ).rejects.toMatchObject({
      status: 409,
      body: { message: expect.stringContaining('create a new link') },
    });
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(
      await db`select uses_count from ${db(tables.links)} where token='legacy-unverified'`,
    ).toEqual([{ uses_count: 0 }]);
    await db`insert into ${db(tables.members)} values(${org},${profile},'owner')`;
    await consumeOrganizationInvite('legacy-unverified', user(), tables);
    expect(await db`select role from ${db(tables.members)} where profile_id=${profile}`).toEqual([
      { role: 'owner' },
    ]);
  });
  it('rejects a legacy admin invitation beyond the actual grantor page, record or field authority', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    for (const restriction of ['module', 'record', 'field', 'page']) {
      await db`update ${db(tables.rules)} set can_view=true,if_owner=false,field_level=1 where role_key=${admin} and module='crm'`;
      await db`delete from ${db(tables.rules)} where role_key=${admin} and module='page:/crm/customers'`;
      if (restriction === 'module')
        await db`update ${db(tables.rules)} set can_view=false where role_key=${admin} and module='crm'`;
      if (restriction === 'record')
        await db`update ${db(tables.rules)} set if_owner=true where role_key=${admin} and module='crm'`;
      if (restriction === 'field')
        await db`update ${db(tables.rules)} set field_level=0 where role_key=${admin} and module='crm'`;
      if (restriction === 'page')
        await db`insert into ${db(tables.rules)} values(${org},${admin},'page:/crm/customers',false,false,false,false,false,false,false,0)`;
      await expect(mint('admin')).rejects.toMatchObject({ status: 403 });
    }
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('approves an omitted legacy role as Staff only within the fresh reviewer ceiling', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    const id = randomUUID();
    await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${org},null,null)`;
    await approveOrganizationRequest(
      id,
      { organizationId: org, reviewerId: 'reviewer', reviewerProfileId: grantor },
      tables,
    );
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: 'staff' }]);
    expect(await db`select status from ${db(tables.requests)} where id=${id}`).toEqual([
      { status: 'approved' },
    ]);
  });
  it('revalidates legacy grantor membership and capability revocation before redemption without consuming use', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    const link = await mint('staff', 1);
    await db`update ${db(tables.rules)} set can_manage=false where role_key=${admin} and module='users'`;
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 403,
    });
    await db`update ${db(tables.rules)} set can_manage=true where role_key=${admin} and module='users'`;
    await db`delete from ${db(tables.members)} where profile_id=${grantor}`;
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 403,
    });
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 0 },
    ]);
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
  });
  it('checks both the admitted and current simulated legacy grantor authority', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    const base = {
      orgId: org,
      profileId: grantor,
      roleKey: 'admin',
      generation: randomUUID(),
      rank: 80,
      invalid: false,
    };
    const restricted = buildCapabilities(
      ['admin'],
      [
        {
          role_key: 'admin',
          module: 'crm',
          can_view: false,
          can_create: false,
          can_edit: false,
          can_delete: false,
          can_export: false,
          can_manage: false,
        },
      ],
    );
    await expect(
      runWithEffectiveAuthority({ ...base, capabilities: restricted }, () => mint('admin')),
    ).rejects.toMatchObject({ status: 403 });
    const admitted = buildCapabilities(['admin'], []);
    await db`insert into ${db(tables.rules)} values(${org},'admin','users',true,false,false,false,false,false,false,0)`;
    await expect(
      runWithEffectiveAuthority({ ...base, capabilities: admitted }, () => mint('staff')),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from ${db(tables.links)}`).toHaveLength(0);
  });
  it('rejects legacy role expansion after minting and leaves the request pending after a denied approval', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    const link = await mint('staff', 1);
    await db`insert into ${db(tables.rules)} values(${org},'staff','brains',true,false,false,false,false,false,false,0)`;
    await expect(consumeOrganizationInvite(link.token, user(), tables)).rejects.toMatchObject({
      status: 409,
    });
    const id = randomUUID();
    await db`insert into ${db(tables.requests)} values(${id},${profile},'pending',${org},null,null)`;
    await db`update ${db(tables.rules)} set if_owner=true where role_key=${admin} and module='crm'`;
    await expect(
      approveOrganizationRequest(
        id,
        { organizationId: org, role: 'admin', reviewerId: 'reviewer', reviewerProfileId: grantor },
        tables,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select status from ${db(tables.requests)} where id=${id}`).toEqual([
      { status: 'pending' },
    ]);
    expect(await db`select uses_count from ${db(tables.links)} where id=${link.id}`).toEqual([
      { uses_count: 0 },
    ]);
    expect(await db`select * from ${db(tables.members)} where profile_id=${profile}`).toHaveLength(
      0,
    );
    expect(await db`select * from ${db(tables.audit)}`).toHaveLength(0);
  });
  it('retains the legacy membership-role fallback when a verified grantor has no explicit assignments', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    await db`delete from ${db(tables.assignments)} where profile_id=${grantor}`;
    await db`update ${db(tables.members)} set role='admin' where profile_id=${grantor}`;
    const link = await mint('staff');
    await consumeOrganizationInvite(link.token, user(), tables);
    expect(
      await db`select role_key from ${db(tables.assignments)} where profile_id=${profile}`,
    ).toEqual([{ role_key: 'staff' }]);
  });
  it('completes verified legacy admission with a one-connection pool and never changes an existing member', async () => {
    const url = process.env.HUB_TEST_DB_URL!;
    const single = postgres(url, { max: 1, prepare: false, connect_timeout: 3 });
    boundary.pool.mockReturnValue(single);
    try {
      await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
      await db`update ${db(tables.assignments)} set role_key='admin' where profile_id=${grantor}`;
      await admitLegacyMembership(org, profile, 'staff', grantor, tables);
      const [member] = await db`select role from ${db(tables.members)} where profile_id=${profile}`;
      expect(member.role).toBe('member');
      await admitLegacyMembership(org, profile, 'admin', grantor, tables);
      const [updated] =
        await db`select role from ${db(tables.members)} where profile_id=${profile}`;
      expect(updated.role).toBe('member');
      expect(
        await db`select role_key from ${db(tables.assignments)} where profile_id=${profile} order by role_key`,
      ).toEqual([expect.objectContaining({ role_key: 'staff' })]);
    } finally {
      boundary.pool.mockReturnValue(db);
      await single.end({ timeout: 2 });
    }
  });
  it('rejects a pending-deletion legacy admission before either membership write', async () => {
    await db`update ${db(tables.organizations)} set role_model='legacy',default_role_key=null where id=${org}`;
    await db`update ${db(tables.profiles)} set deletion_pending=true where id=${profile}`;
    await expect(
      admitLegacyMembership(org, profile, 'staff', grantor, tables),
    ).rejects.toMatchObject({
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
