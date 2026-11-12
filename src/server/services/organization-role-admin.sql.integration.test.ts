import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ARRAY_TYPES } from '$server/db/pg-pool';
const runtime = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('./permissions.service', async () => {
  const { MODULES, ACTIONS } = await import('./rbac.service');
  const { ALL_SUBRESOURCES } = await import('$lib/permissions');
  return {
    capsToLegacyPermissions: (caps: { can: (module: string, action: string) => boolean }) =>
      [...MODULES, ...ALL_SUBRESOURCES.map((row) => row.key)].flatMap((module) =>
        ACTIONS.filter((action) => caps.can(module, action)).map((action) => module + ':' + action),
      ),
  };
});
vi.mock('$server/db/pg-pool', async (original) => ({
  ...(await original<typeof import('$server/db/pg-pool')>()),
  getPgClient: () => runtime.client,
}));
import {
  createOrganizationRole,
  renameOrganizationRole,
  loadRoleSettings,
  setDefaultOrganizationRole,
  mutateOrganizationMemberRoles,
  readOrganizationAdminState,
  hasRecoverableOrganizationAdministrator,
} from './organization-role-admin.service';
import { MODULES, ACTIONS } from './rbac.service';

const enabled = !!process.env.HUB_TEST_DB_URL;
if (process.env.REQUIRE_ORG_ROLES_POSTGRES === '1' && !enabled)
  throw Error('HUB_TEST_DB_URL required');
const suite = enabled ? describe : describe.skip;
const org = '00000000-0000-4000-8000-000000000101',
  owner = '00000000-0000-4000-8000-000000000102',
  member = '00000000-0000-4000-8000-000000000103';
const locals = { user: { supabaseId: owner }, tenantCtx: { tenantId: org } } as App.Locals;
let admin: ReturnType<typeof postgres>, db: ReturnType<typeof postgres>, database: string;
suite('organization-local role administration (native PostgreSQL)', () => {
  beforeAll(async () => {
    const url = new URL(process.env.HUB_TEST_DB_URL!);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
      throw Error('Native tests require loopback');
    admin = postgres(url.toString(), { max: 1 });
    database = 'role113_engine_' + process.pid + '_' + Date.now();
    await admin`create database ${admin(database)}`;
    url.pathname = '/' + database;
    db = postgres(url.toString(), {
      max: 2,
      prepare: false,
      fetch_types: false,
      types: ARRAY_TYPES as unknown as Record<string, postgres.PostgresType>,
    });
    // getCoreDb wraps this SAME pool in production; Drizzle replaces its JSON serializers.
    drizzle(db);
    runtime.client = db;
    await db.unsafe(`
   create table organizations(id uuid primary key,status text default 'active',role_model text,default_role_key text);
   create table profiles(id uuid primary key,role text default 'user');
   create table organization_members(organization_id uuid,profile_id uuid,role text,primary key(organization_id,profile_id));
   create table org_roles(org_id text,key text,name text,rank int,source_role_key text,created_by text,template_id text,template_version int,created_at timestamptz default now(),primary key(org_id,key));
   create table permission_roles(key text primary key,name text,rank int);
   create table member_roles(org_id uuid,profile_id uuid,role_key text,granted_by uuid,primary key(org_id,profile_id,role_key));
   create table permission_rules(org_id uuid,role_key text,module text,can_view boolean,can_create boolean,can_edit boolean,can_delete boolean,can_export boolean,can_manage boolean,if_owner boolean,field_level int,updated_at timestamptz,primary key(org_id,role_key,module));
   create table app_nav_config(org_id text primary key,value jsonb);
   create table doc_audit_log(id uuid,org_id text,ref_type text,ref_id uuid,actor_id uuid,op text,changes jsonb);
  `);
  }, 30000);
  beforeEach(async () => {
    await db.unsafe(
      'truncate organizations,profiles,organization_members,org_roles,permission_roles,member_roles,permission_rules,app_nav_config,doc_audit_log',
    );
    await db`insert into organizations(id,role_model,default_role_key)values(${org},'organization','custom-administrator')`;
    await db`insert into profiles(id)values(${owner}),(${member})`;
    await db`insert into organization_members values(${org},${owner},'owner'),(${org},${member},'member')`;
    await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-administrator','Administrator',80)`;
    await db`insert into member_roles(org_id,profile_id,role_key)values(${org},${owner},'custom-administrator'),(${org},${member},'custom-administrator')`;
    await db`insert into permission_rules ${db(MODULES.map((module) => ({ org_id: org, role_key: 'custom-administrator', module, ...Object.fromEntries(ACTIONS.map((a) => ['can_' + a, true])), if_owner: false, field_level: 1 })))}`;
  });
  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      await admin`drop database if exists ${admin(database)} with (force)`;
      await admin.end();
    }
  });
  it('creates an independent template copy with no assignments and audits atomically', async () => {
    const role = await createOrganizationRole(locals, {
      source: 'template',
      templateId: 'staff',
      templateVersion: 1,
      name: 'Sales',
    });
    expect(role.key).toBe('custom-sales');
    const [crm] =
      await db`select * from permission_rules where role_key=${role.key} and module='crm'`;
    expect(crm).toMatchObject({
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
      can_manage: false,
    });
    expect(await db`select * from member_roles where role_key=${role.key}`).toHaveLength(0);
    const [row] =
      await db`select template_id,template_version from org_roles where key=${role.key}`;
    expect(row).toEqual({ template_id: 'staff', template_version: 1 });
    expect(await db`select * from doc_audit_log`).toHaveLength(1);
    const [audit] =
      await db`select jsonb_typeof(changes) as kind,changes->0->>'field' as field from doc_audit_log`;
    expect(audit).toEqual({ kind: 'array', field: 'role' });
  });
  it('keeps revisions stable before and after Drizzle changes timestamp parsers on the same pool', async () => {
    const url = new URL(process.env.HUB_TEST_DB_URL!);
    url.pathname = '/' + database;
    const pristine = postgres(url.toString(), {
      max: 1,
      prepare: false,
      fetch_types: false,
      types: ARRAY_TYPES as unknown as Record<string, postgres.PostgresType>,
    });
    runtime.client = pristine;
    try {
      await createOrganizationRole(locals, { source: 'blank', name: 'Pristine' });
      const [audit] =
        await pristine`select jsonb_typeof(changes) as kind,changes->0->>'field' as field from doc_audit_log`;
      expect(audit).toEqual({ kind: 'array', field: 'role' });
      const [rawBefore] = await pristine`select created_at from org_roles limit 1`;
      expect(rawBefore.created_at).toBeInstanceOf(Date);
      const before = await loadRoleSettings(org);
      drizzle(pristine);
      const [rawAfter] = await pristine`select created_at from org_roles limit 1`;
      expect(typeof rawAfter.created_at).toBe('string');
      expect((await loadRoleSettings(org)).revision).toBe(before.revision);
    } finally {
      runtime.client = db;
      await pristine.end({ timeout: 2 });
    }
  });
  it('retains raw JSON navigation and its dynamic section ceiling after Drizzle initializes the shared pool', async () => {
    const nav = {
      version: 1,
      sections: [
        {
          id: 'abc123',
          slug: 'marketing',
          label: 'Marketing',
          pages: [{ id: 'crm123', slug: 'crm', label: 'CRM', kind: 'link', target: '/crm' }],
        },
      ],
      builtinSections: {},
      builtin: {},
    };
    await db`insert into app_nav_config values(${org},${JSON.stringify(nav)}::text::jsonb)`;
    await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level) values(${org},'custom-administrator','section:abc123',false,false,false,false,false,false,false,0)`;
    const state = await db.begin((tx) => readOrganizationAdminState(tx, org));
    expect(state.nav).toEqual(nav);
    await expect(
      createOrganizationRole(locals, {
        source: 'template',
        templateId: 'staff',
        templateVersion: 1,
        name: 'Dynamic Escalation',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from org_roles where key='custom-dynamic-escalation'`).toHaveLength(0);
  });
  it('rejects local role257 before mutation with the shared bounded catalog limit', async () => {
    await db`insert into org_roles(org_id,key,name,rank) select ${org},'custom-fixture-'||n,'Fixture '||n,10 from generate_series(1,255)n`;
    await expect(
      createOrganizationRole(locals, { source: 'blank', name: 'Overflow' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db`select * from org_roles where key='custom-overflow'`).toHaveLength(0);
    const [count] = await db`select count(*)::int as roles from org_roles where org_id=${org}`;
    expect(count.roles).toBe(256);
  });

  it('rejects an unknown immutable template version with a recoverable client error', async () => {
    await expect(
      createOrganizationRole(locals, {
        source: 'template',
        templateId: 'staff',
        templateVersion: 2,
        name: 'Invalid',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db`select * from org_roles where key='custom-invalid'`).toHaveLength(0);
  });

  it('preserves legacy duplicate child/page denials without changing the organization model', async () => {
    await db`update organizations set role_model='legacy' where id=${org}`;
    await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level) values(${org},'custom-administrator','page:/crm',false,false,false,false,false,false,false,0),(${org},'custom-administrator','crm.insights',false,false,false,false,false,false,false,0)`;
    const role = await createOrganizationRole(locals, {
      source: 'duplicate',
      sourceRoleKey: 'custom-administrator',
      name: 'Legacy Copy',
    });
    const denied =
      await db`select module,can_view from permission_rules where role_key=${role.key} and module in('page:/crm','crm.insights') order by module`;
    expect(denied).toEqual([
      { module: 'crm.insights', can_view: false },
      { module: 'page:/crm', can_view: false },
    ]);
    expect(await db`select role_model from organizations where id=${org}`).toEqual([
      { role_model: 'legacy' },
    ]);
  });

  it('rejects legacy duplicate inherited grants beyond an actor-only page denial', async () => {
    await db`update organizations set role_model='legacy' where id=${org}`;
    await db`insert into permission_roles(key,name,rank)values('staff','Staff',40) on conflict do nothing`;
    await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level) values(${org},'custom-administrator','page:/crm',false,false,false,false,false,false,false,0)`;
    await expect(
      createOrganizationRole(locals, {
        source: 'duplicate',
        sourceRoleKey: 'staff',
        name: 'Legacy Escalation',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from org_roles where key='custom-legacy-escalation'`).toHaveLength(0);
  });

  it('separates role creation from Team administration and caps a Manager at its own grants', async () => {
    const manager = await createOrganizationRole(locals, {
      source: 'template',
      templateId: 'manager',
      templateVersion: 1,
      name: 'Manager',
    });
    await mutateOrganizationMemberRoles(
      org,
      member,
      { mode: 'replace', roleKey: manager.key },
      owner,
    );
    const managerLocals = {
      user: { supabaseId: member },
      tenantCtx: { tenantId: org },
    } as App.Locals;
    await expect(
      createOrganizationRole(managerLocals, {
        source: 'template',
        templateId: 'staff',
        templateVersion: 1,
        name: 'Sales',
      }),
    ).resolves.toMatchObject({ key: 'custom-sales' });
    await expect(
      createOrganizationRole(managerLocals, {
        source: 'template',
        templateId: 'admin',
        templateVersion: 1,
        name: 'Escalated',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      mutateOrganizationMemberRoles(org, member, { mode: 'add', roleKey: 'custom-sales' }, member),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('does not let a Team manager create or edit role definitions without role CRUD', async () => {
    const staff = await createOrganizationRole(locals, {
      source: 'template',
      templateId: 'staff',
      templateVersion: 1,
      name: 'Staff',
    });
    await db`update permission_rules set can_view=true,can_manage=true where role_key=${staff.key} and module='users'`;
    await mutateOrganizationMemberRoles(
      org,
      member,
      { mode: 'replace', roleKey: staff.key },
      owner,
    );
    const staffLocals = {
      user: { supabaseId: member },
      tenantCtx: { tenantId: org },
    } as App.Locals;
    await expect(
      createOrganizationRole(staffLocals, { source: 'blank', name: 'Forbidden' }),
    ).rejects.toMatchObject({ status: 403 });
    const state = await loadRoleSettings(org);
    await expect(
      renameOrganizationRole(staffLocals, staff.key, {
        name: 'Elevated label',
        revision: state.revision,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rename preserves the key and stale revisions cannot change the default', async () => {
    const role = await createOrganizationRole(locals, { source: 'blank', name: 'Marketing' });
    const before = await loadRoleSettings(org);
    await renameOrganizationRole(locals, role.key, {
      name: 'Staff-Marketing',
      revision: before.revision,
    });
    await expect(
      setDefaultOrganizationRole(locals, { roleKey: role.key, revision: before.revision }),
    ).rejects.toMatchObject({ status: 409 });
    const [saved] = await db`select key,name from org_roles where key=${role.key}`;
    expect(saved).toEqual({ key: 'custom-marketing', name: 'Staff-Marketing' });
  });
  it('rejects a grant beyond the real actor even when the rank would fit', async () => {
    await db`update permission_rules set can_manage=false where role_key='custom-administrator' and module='brains'`;
    await expect(
      createOrganizationRole(locals, {
        source: 'template',
        templateId: 'admin',
        templateVersion: 1,
        name: 'Elevated',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from org_roles where key='custom-elevated'`).toHaveLength(0);
  });
  it('cannot create a template that inherits an actor-only explicit page or child denial', async () => {
    await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level) values(${org},'custom-administrator','page:/crm',false,false,false,false,false,false,false,0)`;
    await expect(
      createOrganizationRole(locals, {
        source: 'template',
        templateId: 'staff',
        templateVersion: 1,
        name: 'Marketing',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from org_roles where key='custom-marketing'`).toHaveLength(0);
    await db`delete from permission_rules where module='page:/crm'`;
    await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level) values(${org},'custom-administrator','crm.insights',false,false,false,false,false,false,false,0)`;
    await expect(
      createOrganizationRole(locals, {
        source: 'template',
        templateId: 'staff',
        templateVersion: 1,
        name: 'Marketing',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('copies explicit page denials and field restrictions when duplicating', async () => {
    await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)values(${org},'custom-administrator','page:/crm',false,false,false,false,false,false,false,0)`;
    const role = await createOrganizationRole(locals, {
      source: 'duplicate',
      sourceRoleKey: 'custom-administrator',
      name: 'Second admin',
    });
    const [page] =
      await db`select can_view from permission_rules where role_key=${role.key} and module='page:/crm'`;
    expect(page.can_view).toBe(false);
  });
  it('allows replacing one administrator but atomically rejects removal of the final one', async () => {
    const role = await createOrganizationRole(locals, { source: 'blank', name: 'Restricted' });
    await mutateOrganizationMemberRoles(org, member, { mode: 'replace', roleKey: role.key }, owner);
    await expect(
      mutateOrganizationMemberRoles(org, owner, { mode: 'replace', roleKey: role.key }, owner),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db`select role_key from member_roles where profile_id=${owner}`).toEqual([
      expect.objectContaining({ role_key: 'custom-administrator' }),
    ]);
  });
  it('serializes concurrent self-downgrades so one real administrator survives', async () => {
    const role = await createOrganizationRole(locals, { source: 'blank', name: 'Restricted' });
    const results = await Promise.allSettled([
      mutateOrganizationMemberRoles(org, owner, { mode: 'replace', roleKey: role.key }, owner),
      mutateOrganizationMemberRoles(org, member, { mode: 'replace', roleKey: role.key }, member),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const admins =
      await db`select profile_id from member_roles where org_id=${org} and role_key='custom-administrator'`;
    expect(admins).toHaveLength(1);
  });

  it('includes actual management page denials in the post-change recovery proof', async () => {
    const state = await db.begin((tx) => readOrganizationAdminState(tx, org));
    expect(hasRecoverableOrganizationAdministrator(state)).toBe(true);
    state.rules.push({
      role_key: 'custom-administrator',
      module: 'page:/settings/roles',
      can_view: false,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_export: false,
      can_manage: false,
    });
    expect(hasRecoverableOrganizationAdministrator(state)).toBe(false);
  });
});
