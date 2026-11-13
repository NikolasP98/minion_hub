import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
const boundary = vi.hoisted(() => ({ db: vi.fn(), policy: vi.fn(), capabilities: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: boundary.db,
  getOrgTransactionDb: (database: unknown) => database,
}));
vi.mock('./organization-role-policy', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadOrganizationRolePolicy: boundary.policy,
}));
vi.mock('./rbac.service', async (original) => ({
  ...(await original<typeof import('./rbac.service')>()),
  resolveCapabilities: boundary.capabilities,
}));
vi.mock('./embeddings', () => ({ embeddingsEnabled: () => false }));
vi.mock('./bg-runtime', () => ({ registerJobHandler: () => {} }));
import { canAccessBrain } from './brains.service';
import { parseOrganizationRolePolicy } from './organization-role-policy';
import {
  legacyRoleKey,
  buildCapabilities,
  resolveMemberRoleKeys,
  type CapabilityOverrideRow,
} from './rbac.service';
import {
  readSectionAccess,
  writeSectionAccess,
  deleteRoleAccessCatalog,
  listRoleAccessMatrix,
  resetRegisteredRolePolicies,
} from './section-access.service';
import { writeNavConfig } from './nav-config.service';
import { lockNavigationPolicy } from './nav-policy-lock';

const databaseUrl = testDatabaseUrl();
if (!databaseUrl)
  throw new Error('Section policy native qualification requires explicit HUB_TEST_DB_URL');
const url = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port)
  throw new Error('Section policy native qualification requires explicit loopback PostgreSQL');
const schema = `qc_section_access_${randomUUID().replaceAll('-', '')}`;
const application = `section-access-${randomUUID()}`;
const owner = postgres(databaseUrl, { max: 1, prepare: false });
const app = postgres(databaseUrl, {
  max: 3,
  prepare: false,
  connection: { search_path: `${schema},pg_catalog`, application_name: application },
});
const blocker = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connection: { search_path: `${schema},pg_catalog` },
});
const db = drizzle(app);
const org = '10000000-0000-4000-8000-000000000001';
const profile = '20000000-0000-4000-8000-000000000001';
const locals = {
  user: {
    id: profile,
    supabaseId: profile,
    role: 'user',
    email: 'fixture@example.invalid',
    displayName: 'Fixture',
  },
  tenantCtx: { tenantId: org },
} as App.Locals;
const nav = {
  version: 1 as const,
  sections: [{ id: 'abc123', slug: 'team', label: 'Team', pages: [] }],
  builtinSections: {},
  builtin: {},
};
let created = false;
beforeAll(async () => {
  await owner.unsafe(`create schema "${schema}"`);
  created = true;
  await owner.unsafe(`
    create table "${schema}".organizations(id uuid primary key,name text,status text,role_model text default 'legacy',default_role_key text);
    create table "${schema}".profiles(id uuid primary key,role text);
    create table "${schema}".organization_members(organization_id uuid,profile_id uuid,role text);
    create table "${schema}".member_roles(org_id uuid,profile_id uuid,role_key text);
    create table "${schema}".permission_roles(key text primary key,name text,rank integer,description text,is_system boolean);
    create table "${schema}".org_roles(org_id text,key text,name text,rank integer,source_role_key text);
    create table "${schema}".permission_rules(org_id uuid,role_key text,module text,can_view boolean,can_create boolean,can_edit boolean,
      can_delete boolean,can_export boolean,can_manage boolean,if_owner boolean default false,field_level integer default 0,
      updated_at timestamptz default now(),unique(org_id,role_key,module));
    create table "${schema}".app_nav_config(org_id text primary key,value jsonb,updated_at timestamptz default now());
    create table "${schema}".brains(id uuid primary key,org_id text,name text,description text,icon text,visibility text,kind text default 'focused',include_all_sources boolean default false,agent_id text,created_by text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table "${schema}".brain_access(brain_id uuid,org_id text,principal_type text,principal_id text,level text,primary key(brain_id,principal_type,principal_id));
    create table "${schema}".personal_agents(profile_id uuid,agent_id text);
    grant usage on schema "${schema}" to app_ledger;
    grant select on "${schema}".brains,"${schema}".brain_access to app_ledger;
    alter table "${schema}".brains enable row level security;
    alter table "${schema}".brains force row level security;
    create policy brain_org_scope on "${schema}".brains to app_ledger using(org_id=current_setting('app.current_org_id',true));
    alter table "${schema}".brain_access enable row level security;
    alter table "${schema}".brain_access force row level security;
    create policy access_org_scope on "${schema}".brain_access to app_ledger using(org_id=current_setting('app.current_org_id',true));
    grant select,insert,update,delete on "${schema}".app_nav_config to app_ledger;
    alter table "${schema}".app_nav_config enable row level security;
    alter table "${schema}".app_nav_config force row level security;
    create policy nav_org_scope on "${schema}".app_nav_config for all to app_ledger
      using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
    create table "${schema}".doc_audit_log(org_id text,ref_type text,ref_id uuid,actor_id uuid,actor_name text,op text,changes jsonb,
      simulation_role_key text,simulation_generation uuid);
  `);
  boundary.db.mockReturnValue(db);
  // Resolve the policy transport from this real fixture, retaining its parser
  // and the actual Brain predicate rather than a fabricated access result.
  boundary.policy.mockImplementation(async (id: string) => {
    const [row] =
      await app`select role_model,default_role_key from organizations where id=${id}::uuid`;
    return parseOrganizationRolePolicy(row);
  });
  // Only the capability-loader transport changes: canonical role selection and
  // capability construction still read the native fixture's committed rows.
  boundary.capabilities.mockImplementation(async (id: string, who: string) => {
    const [membership] = await app<
      { role: string }[]
    >`select role from organization_members where organization_id=${id}::uuid and profile_id=${who}::uuid`;
    const assigned = await app<
      { role_key: string }[]
    >`select role_key from member_roles where org_id=${id}::uuid and profile_id=${who}::uuid`;
    const [metadata] =
      await app`select role_model,default_role_key from organizations where id=${id}::uuid`;
    const policy = parseOrganizationRolePolicy(metadata);
    const catalog = await app<{ key: string }[]>`select key from org_roles where org_id=${id}`;
    const rules = await app<
      CapabilityOverrideRow[]
    >`select role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level from permission_rules where org_id=${id}::uuid`;
    return buildCapabilities(
      membership
        ? resolveMemberRoleKeys(
            assigned.map((row) => row.role_key),
            membership.role,
            policy.roleModel,
            catalog.map((row) => row.key),
          )
        : [],
      rules,
    );
  });
});
beforeEach(async () => {
  await app`truncate organizations,profiles,organization_members,member_roles,permission_roles,org_roles,permission_rules,app_nav_config,doc_audit_log,brains,brain_access,personal_agents`;
  await app`insert into organizations(id,name,status) values (${org},'Fixture org','active')`;
  await app`insert into profiles values (${profile},'user')`;
  await app`insert into organization_members values (${org},${profile},'owner')`;
  await app`insert into member_roles values (${org},${profile},'owner')`;
  await app`insert into permission_roles values ('owner','Owner',100,null,true),('viewer','Viewer',20,null,true)`;
  await app`insert into app_nav_config(org_id,value) values (${org},${JSON.stringify(nav)}::jsonb)`;
});

const foreignBrain = '30000000-0000-4000-8000-000000000001';
const recipient = '20000000-0000-4000-8000-000000000002';
const privateCreator = '20000000-0000-4000-8000-000000000003';
async function privateRolePolicy() {
  await app`insert into org_roles(org_id,key,name,rank) values(${org},'custom-editor','Editor',80)`;
  await app`update member_roles set role_key='custom-editor' where profile_id=${profile}::uuid`;
  await app`insert into profiles values(${recipient}::uuid,'user')`;
  await app`insert into organization_members values(${org}::uuid,${recipient}::uuid,'member')`;
  await app`insert into member_roles values(${org}::uuid,${recipient}::uuid,'viewer')`;
  await app`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage)
    values(${org}::uuid,'custom-editor','roles',true,true,true,true,true,true),
      (${org}::uuid,'custom-editor','brains',true,true,true,true,true,true),
      (${org}::uuid,'viewer','brains',true,false,true,false,false,false)`;
  await app`update permission_rules set field_level=2 where role_key='custom-editor' and module='brains'`;
  await app`insert into brains(id,org_id,name,visibility,created_by)
    values(${foreignBrain}::uuid,${org},'Private recipient Brain','private',${privateCreator})`;
  await app`insert into brain_access values(${foreignBrain}::uuid,${org},'role','viewer','write')`;
}
async function actualBrainWrite(profileId: string, agentId?: string) {
  if (agentId) {
    const owners = await app<
      { profile_id: string }[]
    >`select profile_id::text from personal_agents where lower(agent_id)=lower(${agentId})`;
    expect(owners).toEqual([{ profile_id: profileId }]);
  }
  const rows = await app<{ role_key: string }[]>`select role_key from member_roles
    where org_id=${org}::uuid and profile_id=${profileId}::uuid`;
  const [membership] = await app<{ role: string }[]>`select role from organization_members
    where organization_id=${org}::uuid and profile_id=${profileId}::uuid`;
  return canAccessBrain(
    { db, tenantId: org, profileId } as unknown as CoreCtx,
    foreignBrain,
    'write',
    {
      profileId,
      agentId,
      roles: rows.length ? rows.map((row) => row.role_key) : [legacyRoleKey(membership?.role)],
    },
  );
}
const brainEdit = {
  view: true,
  create: false,
  edit: true,
  delete: false,
  export: false,
  manage: false,
};
describe('recipient data authority across role unions', () => {
  it('does not activate a recipient hidden higher rank through a lower-rank management grant', async () => {
    await privateRolePolicy();
    await app`update org_roles set rank=60 where key='custom-editor'`;
    await app`insert into org_roles(org_id,key,name,rank) values(${org},'custom-silent','Silent',80)`;
    await app`insert into member_roles values(${org}::uuid,${recipient}::uuid,'custom-silent')`;
    await app`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage)
      values(${org}::uuid,'viewer','roles',false,false,false,false,false,false)`;
    const snapshot = await readSectionAccess(locals, 'roles');
    const rev = snapshot.roles.find((row) => row.key === 'viewer')!.revision;
    await expect(
      writeSectionAccess(locals, {
        target: 'roles',
        roleKey: 'viewer',
        revision: rev,
        mode: 'override',
        caps: { view: true, create: true, edit: true, delete: true, export: false, manage: false },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await app`select can_create,can_edit,can_delete from permission_rules where role_key='viewer' and module='roles'`,
    ).toEqual([{ can_create: false, can_edit: false, can_delete: false }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
    await writeSectionAccess(locals, {
      target: 'roles',
      roleKey: 'viewer',
      revision: rev,
      mode: 'override',
      caps: { view: true, create: false, edit: false, delete: false, export: false, manage: false },
    });
    expect((await boundary.capabilities(org, recipient)).can('roles', 'view')).toBe(true);
    expect((await boundary.capabilities(org, recipient)).can('roles', 'edit')).toBe(false);
  });
  it('does not open an inherited page through another recipient role when removing a dormant denial', async () => {
    await privateRolePolicy();
    await app`insert into org_roles(org_id,key,name,rank) values(${org},'custom-reader','Reader',10)`;
    await app`insert into member_roles values(${org}::uuid,${recipient}::uuid,'custom-reader')`;
    await app`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage)
      values(${org}::uuid,'custom-editor','crm',true,false,false,false,false,false),
        (${org}::uuid,'custom-reader','crm',true,false,false,false,false,false),
        (${org}::uuid,'viewer','crm',false,false,false,false,false,false),
        (${org}::uuid,'custom-editor','page:/crm',false,false,false,false,false,false),
        (${org}::uuid,'viewer','page:/crm',false,false,false,false,false,false)`;
    const snapshot = await readSectionAccess(locals, 'page:/crm');
    await expect(
      writeSectionAccess(locals, {
        target: 'page:/crm',
        roleKey: 'viewer',
        revision: snapshot.roles.find((row) => row.key === 'viewer')!.revision,
        mode: 'inherit',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await app`select can_view from permission_rules where role_key='viewer' and module='page:/crm'`,
    ).toEqual([{ can_view: false }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
  });
  it.each(['hidden-field', 'record-scope', 'export-field'] as const)(
    'rejects a %s increase activated by another recipient role',
    async (kind) => {
      await privateRolePolicy();
      const scoped = kind === 'record-scope';
      await app`insert into org_roles(org_id,key,name,rank) values(${org},'custom-reader','Reader',10)`;
      await app`insert into member_roles values(${org}::uuid,${recipient}::uuid,'custom-reader')`;
      await app`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)
        values(${org}::uuid,'custom-editor','crm',true,false,true,false,true,false,${scoped},0),
          (${org}::uuid,'viewer','crm',false,false,false,false,false,false,${scoped},0),
          (${org}::uuid,'custom-reader','crm',true,false,false,false,false,false,false,${kind === 'export-field' ? 1 : 0})`;
      const before = await boundary.capabilities(org, recipient);
      expect(before.can('crm', 'view')).toBe(true);
      expect(before.fieldLevel('crm')).toBe(kind === 'export-field' ? 1 : 0);
      if (scoped) {
        expect(before.can('crm', 'edit')).toBe(false);
        expect(before.ownerScoped('crm')).toBe(false);
      }
      const caps =
        kind === 'hidden-field'
          ? { view: false, create: false, edit: false, delete: false, export: false, manage: false }
          : {
              view: true,
              create: false,
              edit: scoped,
              delete: false,
              export: kind === 'export-field',
              manage: false,
            };
      const request = {
        target: 'crm',
        roleKey: 'viewer',
        revision: await revision('crm'),
        mode: 'override' as const,
        caps,
        ifOwner: scoped,
        fieldLevel: kind === 'hidden-field' ? 1 : 0,
      };
      await expect(writeSectionAccess(locals, request)).rejects.toMatchObject({ status: 403 });
      expect(
        await app`select can_view,can_edit,can_export,field_level from permission_rules where role_key='viewer' and module='crm'`,
      ).toEqual([{ can_view: false, can_edit: false, can_export: false, field_level: 0 }]);
      expect(await app`select * from doc_audit_log`).toHaveLength(0);
      if (kind === 'export-field') {
        await app`update permission_rules set field_level=1 where role_key='custom-editor' and module='crm'`;
        await writeSectionAccess(locals, { ...request, revision: await revision('crm') });
        const granted = await boundary.capabilities(org, recipient);
        expect(granted.can('crm', 'export')).toBe(true);
        expect(granted.fieldLevel('crm')).toBe(1);
        expect(await app`select * from doc_audit_log`).toHaveLength(1);
      }
    },
  );
});
describe('private Brain effects of role policy edits', () => {
  it('does not lend synthetic platform role-edit authority to canonical private Brain grants', async () => {
    await useOrganizationModel();
    await privateRolePolicy();
    await app`insert into org_roles(org_id,key,name,rank) values(${org},'custom-viewer','Viewer',20)`;
    await app`update permission_rules set role_key='custom-viewer' where role_key='viewer'`;
    await app`update member_roles set role_key='custom-viewer' where profile_id=${recipient}::uuid`;
    await app`update brain_access set principal_id='custom-viewer' where principal_type='role'`;
    await app`update profiles set role='admin' where id=${profile}::uuid`;
    await app`update permission_rules set can_manage=false where role_key='custom-editor' and module='brains'`;
    // A separate actual Administrator survives, so rejection must come from
    // object delegation rather than the recovery invariant.
    await app`insert into profiles values(${privateCreator}::uuid,'user')`;
    await app`insert into organization_members values(${org}::uuid,${privateCreator}::uuid,'member')`;
    await app`insert into member_roles values(${org}::uuid,${privateCreator}::uuid,'custom-administrator')`;
    expect(await actualBrainWrite(profile)).toBe(false);
    const adminLocals = { ...locals, user: { ...locals.user!, role: 'admin' } } as App.Locals;
    const snapshot = await readSectionAccess(adminLocals, 'brains');
    await expect(
      writeSectionAccess(adminLocals, {
        target: 'brains',
        roleKey: 'custom-viewer',
        revision: snapshot.roles.find((row) => row.key === 'custom-viewer')!.revision,
        mode: 'override',
        caps: { ...brainEdit, manage: true },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await app`select can_manage from permission_rules where role_key='custom-viewer' and module='brains'`,
    ).toEqual([{ can_manage: false }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
    expect(await actualBrainWrite(profile)).toBe(false);
    await app`update permission_rules set can_manage=true where role_key='custom-editor' and module='brains'`;
    expect(await actualBrainWrite(profile)).toBe(true);
    const authorized = await readSectionAccess(adminLocals, 'brains');
    await writeSectionAccess(adminLocals, {
      target: 'brains',
      roleKey: 'custom-viewer',
      revision: authorized.roles.find((row) => row.key === 'custom-viewer')!.revision,
      mode: 'override',
      caps: { ...brainEdit, manage: true },
    });
    expect(
      await app`select can_manage from permission_rules where role_key='custom-viewer' and module='brains'`,
    ).toEqual([{ can_manage: true }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(1);
  });
  it('rejects a Brain edit action activated through the recipient verified personal agent', async () => {
    await privateRolePolicy();
    const agentId = `personal-${recipient}`;
    await app`delete from brain_access`;
    await app`insert into personal_agents values(${recipient}::uuid,${agentId})`;
    await app`insert into brain_access values(${foreignBrain}::uuid,${org},'agent',${agentId},'write')`;
    await app`update permission_rules set can_edit=false where role_key='viewer' and module='brains'`;
    expect(await actualBrainWrite(profile)).toBe(false);
    expect(await actualBrainWrite(recipient)).toBe(false);
    expect(await actualBrainWrite(recipient, agentId)).toBe(true);
    await expect(
      writeSectionAccess(locals, {
        target: 'brains',
        roleKey: 'viewer',
        revision: await revision('brains'),
        mode: 'override',
        caps: brainEdit,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await app`select can_edit from permission_rules where role_key='viewer' and module='brains'`,
    ).toEqual([{ can_edit: false }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
  });
  it.each(['user', 'creator', 'other-role', 'fallback'] as const)(
    'rejects new Brain actions activated through recipient %s authority',
    async (source) => {
      await privateRolePolicy();
      await app`delete from brain_access`;
      let roleKey = 'viewer';
      if (source === 'creator')
        await app`update brains set created_by=${recipient} where id=${foreignBrain}::uuid`;
      else if (source === 'other-role') {
        await app`insert into org_roles(org_id,key,name,rank) values(${org},'custom-other','Other',30)`;
        await app`insert into member_roles values(${org}::uuid,${recipient}::uuid,'custom-other')`;
        await app`insert into brain_access values(${foreignBrain}::uuid,${org},'role','custom-other','write')`;
      } else {
        await app`insert into brain_access values(${foreignBrain}::uuid,${org},'user',${recipient},'write')`;
        if (source === 'fallback') {
          roleKey = 'manager';
          await app`insert into permission_roles values('manager','Manager',60,null,true)`;
          await app`delete from member_roles where profile_id=${recipient}::uuid`;
          await app`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage)
            values(${org}::uuid,'manager','brains',true,false,true,false,false,false)`;
        }
      }
      expect(await actualBrainWrite(profile)).toBe(false);
      expect(await actualBrainWrite(recipient)).toBe(true);
      const snapshot = await readSectionAccess(locals, 'brains');
      await expect(
        writeSectionAccess(locals, {
          target: 'brains',
          roleKey,
          revision: snapshot.roles.find((row) => row.key === roleKey)!.revision,
          mode: 'override',
          caps: { ...brainEdit, delete: true },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await app`select can_delete from permission_rules where role_key=${roleKey} and module='brains'`,
      ).toEqual([{ can_delete: false }]);
      expect(await app`select * from doc_audit_log`).toHaveLength(0);
      expect(await actualBrainWrite(profile)).toBe(false);
    },
  );
  it('rejects adding delete to an already writable role Brain outside the editor object authority', async () => {
    await privateRolePolicy();
    expect(await actualBrainWrite(profile)).toBe(false);
    expect(await actualBrainWrite(recipient)).toBe(true);
    await expect(
      writeSectionAccess(locals, {
        target: 'brains',
        roleKey: 'viewer',
        revision: await revision('brains'),
        mode: 'override',
        caps: { ...brainEdit, delete: true },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await app`select can_delete from permission_rules where role_key='viewer' and module='brains'`,
    ).toEqual([{ can_delete: false }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
    expect(await actualBrainWrite(profile)).toBe(false);
  });
  it('allows an object-authorized editor to grant a matching Brain action', async () => {
    await privateRolePolicy();
    await app`insert into brain_access values(${foreignBrain}::uuid,${org},'user',${profile},'write')`;
    expect(await actualBrainWrite(profile)).toBe(true);
    await writeSectionAccess(locals, {
      target: 'brains',
      roleKey: 'viewer',
      revision: await revision('brains'),
      mode: 'override',
      caps: { ...brainEdit, delete: true },
    });
    expect(
      await app`select can_delete from permission_rules where role_key='viewer' and module='brains'`,
    ).toEqual([{ can_delete: true }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(1);
    expect(await actualBrainWrite(recipient)).toBe(true);
  });
  it('allows a pure Brain action revocation without authority over retained private objects', async () => {
    await privateRolePolicy();
    expect(await actualBrainWrite(profile)).toBe(false);
    await writeSectionAccess(locals, {
      target: 'brains',
      roleKey: 'viewer',
      revision: await revision('brains'),
      mode: 'override',
      caps: { ...brainEdit, edit: false },
    });
    expect(
      await app`select can_edit from permission_rules where role_key='viewer' and module='brains'`,
    ).toEqual([{ can_edit: false }]);
  });
  it('rejects inherited Brain action reset that would unlock a foreign private role grant', async () => {
    await privateRolePolicy();
    await app`delete from permission_rules where role_key='viewer' and module='brains'`;
    await app`insert into org_roles(org_id,key,name,rank,source_role_key) values(${org},'custom-private','Private',40,null)`;
    await app`update brain_access set principal_id='custom-private' where principal_type='role'`;
    // Admin defaults include private-Brain name authority even when its stored
    // matrix currently denies view. Reset must recheck that future scope.
    await app`insert into permission_roles values('admin','Admin',80,null,true)`;
    await app`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage)
      values(${org}::uuid,'admin','brains',false,false,false,false,false,false)`;
    const snap = await readSectionAccess(locals, 'brains');
    const rev = snap.roles.find((row) => row.key === 'admin')!.revision;
    await expect(
      resetRegisteredRolePolicies(locals, 'admin', [{ target: 'brains', revision: rev }]),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await app`select can_view from permission_rules where role_key='admin' and module='brains'`,
    ).toEqual([{ can_view: false }]);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
  });
});
afterAll(async () => {
  await Promise.all([app.end({ timeout: 5 }), blocker.end({ timeout: 5 })]);
  try {
    if (created) await owner.unsafe(`drop schema "${schema}" cascade`);
  } finally {
    await owner.end({ timeout: 5 });
  }
});
async function waitForBlocked(minimum: number) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const [row] = await owner<
      { count: number }[]
    >`select count(*)::integer as count from pg_stat_activity
      where application_name=${application} and wait_event_type='Lock'`;
    if ((row?.count ?? 0) >= minimum) return row.count;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('Policy writers never reached the required independent PostgreSQL lock wait');
}
async function holdOrgLock() {
  let ready!: () => void;
  let release!: () => void;
  const admitted = new Promise<void>((done) => {
    ready = done;
  });
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const held = blocker.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${org},112))`;
    ready();
    await gate;
  });
  await admitted;
  return { release, held };
}
async function revision(target: string) {
  return (await readSectionAccess(locals, target)).roles.find((row) => row.key === 'viewer')!
    .revision;
}
describe('section policy against concurrent PostgreSQL transactions', () => {
  it('serializes independent first overrides and commits exactly one with its audit', async () => {
    const old = await revision('crm');
    const lock = await holdOrgLock();
    const input = { target: 'crm', roleKey: 'viewer', revision: old, mode: 'deny' };
    const first = writeSectionAccess(locals, input);
    const second = writeSectionAccess(locals, input);
    const settled = Promise.allSettled([first, second]);
    try {
      await waitForBlocked(2);
    } finally {
      lock.release();
      await lock.held;
    }
    const outcomes = await settled;
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    expect(
      await app`select * from permission_rules where role_key='viewer' and module='crm'`,
    ).toHaveLength(1);
    expect(await app`select * from doc_audit_log where op='permission'`).toHaveLength(1);
  });
  it('serializes whole-nav removal and rejects a queued policy for the deleted target', async () => {
    await writeSectionAccess(locals, {
      target: 'section:abc123',
      roleKey: 'viewer',
      revision: await revision('section:abc123'),
      mode: 'deny',
    });
    const old = await revision('section:abc123');
    const lock = await holdOrgLock();
    const removed = writeNavConfig(
      { db: db as never, tenantId: org, profileId: profile },
      { ...nav, sections: [] },
    );
    let queued: Promise<unknown> | undefined;
    try {
      await waitForBlocked(1);
      queued = writeSectionAccess(locals, {
        target: 'section:abc123',
        roleKey: 'viewer',
        revision: old,
        mode: 'inherit',
      });
      // Attach before release, so the expected rejection is never unhandled.
      const result = queued.catch((cause: unknown) => cause);
      await waitForBlocked(2);
      lock.release();
      await lock.held;
      await removed;
      expect(await result).toMatchObject({ status: 404 });
      expect(await app`select * from permission_rules where module='section:abc123'`).toHaveLength(
        0,
      );
      expect(await app`select * from doc_audit_log where op='target_removed'`).toHaveLength(1);
    } finally {
      lock.release();
      await lock.held;
      await Promise.allSettled([removed, ...(queued ? [queued] : [])]);
    }
  });

  it('serializes custom-role removal and rejects a queued override for the deleted catalog key', async () => {
    await app`insert into org_roles values (${org},'custom-temp','Temporary',20,'viewer')`;
    const old = (await readSectionAccess(locals, 'crm')).roles.find(
      (row) => row.key === 'custom-temp',
    )!.revision;
    const lock = await holdOrgLock();
    const removed = deleteRoleAccessCatalog(locals, 'custom-temp');
    let queued: Promise<unknown> | undefined;
    try {
      await waitForBlocked(1);
      queued = writeSectionAccess(locals, {
        target: 'crm',
        roleKey: 'custom-temp',
        revision: old,
        mode: 'deny',
      });
      const result = queued.catch((cause: unknown) => cause);
      await waitForBlocked(2);
      lock.release();
      await lock.held;
      await removed;
      expect(await result).toMatchObject({ status: 400 });
      expect(await app`select * from permission_rules where role_key='custom-temp'`).toHaveLength(
        0,
      );
      expect(await app`select * from org_roles where key='custom-temp'`).toHaveLength(0);
    } finally {
      lock.release();
      await lock.held;
      await Promise.allSettled([removed, ...(queued ? [queued] : [])]);
    }
  });
  it('uses the same advisory key for the exported coordinator', async () => {
    const lock = await holdOrgLock();
    const coordinated = db.transaction((tx) => lockNavigationPolicy(tx as unknown as CoreTx, org));
    let blocked = 0;
    try {
      blocked = await waitForBlocked(1);
    } finally {
      lock.release();
      await lock.held;
    }
    await coordinated;
    expect(blocked).toBeGreaterThanOrEqual(1);
  });
});

async function useOrganizationModel() {
  await app`update organizations set role_model='organization',default_role_key='custom-administrator' where id=${org}::uuid`;
  await app`insert into org_roles(org_id,key,name,rank) values(${org},'custom-administrator','Administrator',80)`;
  await app`delete from member_roles where org_id=${org}::uuid`;
  await app`insert into member_roles values(${org}::uuid,${profile}::uuid,'custom-administrator')`;
  for (const module of [
    'overview',
    'crm',
    'finance',
    'sales',
    'scheduling',
    'support',
    'projects',
    'memberships',
    'comms',
    'brains',
    'stock',
    'ads',
    'pos',
    'pulse',
    'agents',
    'channels',
    'flows',
    'marketplace',
    'reliability',
    'workspace',
    'settings',
    'users',
    'roles',
    'tools',
  ]) {
    await app`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)
      values(${org}::uuid,'custom-administrator',${module},true,true,true,true,true,true,false,1)`;
  }
}
describe('organization-local page and data policy integration', () => {
  it('lists only organization roles in both policy editors', async () => {
    await useOrganizationModel();
    expect((await listRoleAccessMatrix(org)).map((r) => r.key)).toEqual(['custom-administrator']);
    expect((await readSectionAccess(locals, 'crm')).roles.map((r) => r.key)).toEqual([
      'custom-administrator',
    ]);
  });
  it('rejects denying the final access administrator its management page and rolls back the policy', async () => {
    await useOrganizationModel();
    const snapshot = await readSectionAccess(locals, 'page:/settings/roles');
    await expect(
      writeSectionAccess(locals, {
        target: 'page:/settings/roles',
        roleKey: 'custom-administrator',
        mode: 'deny',
        revision: snapshot.roles[0].revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await app`select * from permission_rules where module='page:/settings/roles'`,
    ).toHaveLength(0);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
  });
  it('rejects removing final users manage permission while legacy edits stay unchanged', async () => {
    await useOrganizationModel();
    const snapshot = await readSectionAccess(locals, 'users');
    await expect(
      writeSectionAccess(locals, {
        target: 'users',
        roleKey: 'custom-administrator',
        mode: 'deny',
        revision: snapshot.roles[0].revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await app`select can_manage from permission_rules where role_key='custom-administrator' and module='users'`,
    ).toMatchObject([{ can_manage: true }]);
  });
});
