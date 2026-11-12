import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ARRAY_TYPES } from '$server/db/pg-pool';
const runtime = vi.hoisted(() => ({ client: null as unknown, postgrestCalls: 0 }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from: legacyPostgrest }) }));
vi.mock('./embeddings', () => ({ embeddingsEnabled: () => false }));
vi.mock('./crm-contacts.service', () => ({}));
vi.mock('./stock.service', () => ({}));
vi.mock('./finance-products.service', () => ({}));
vi.mock('./bg-runtime', () => ({ registerJobHandler: () => {} }));
vi.mock('./job-effects.service', () => ({}));
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
  memberAuthority,
} from './organization-role-admin.service';
import {
  MODULES,
  ACTIONS,
  buildCapabilities,
  setMemberRole,
  addMemberRole,
  removeMemberRole,
  type CapabilityOverrideRow,
  resolveMemberRoleKeys,
} from './rbac.service';
import { canAccessBrain } from './brains.service';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import {
  runWithRequestCapabilities,
  runWithEffectiveAuthority,
} from '$server/auth/effective-authority';

// Exercise the former legacy HTTP-client path against real SQL before the
// transactional adapter replaces it; this does not mock capability resolution.
interface LegacyFixtureResult {
  data: unknown;
  error: null;
}
class LegacyFixtureQuery implements PromiseLike<LegacyFixtureResult> {
  private operation = 'select';
  private fields = '*';
  private single = false;
  private row: Record<string, unknown> = {};
  private conflict = false;
  private filters: { key: string; value: string }[] = [];
  constructor(private table: string) {
    if (
      ![
        'profiles',
        'member_roles',
        'permission_roles',
        'org_roles',
        'organization_members',
      ].includes(table)
    )
      throw Error('Unexpected fixture table');
    runtime.postgrestCalls++;
  }
  select(value: string): this {
    this.fields = value;
    return this;
  }
  eq(key: string, value: string): this {
    this.filters.push({ key, value });
    return this;
  }
  maybeSingle(): Promise<LegacyFixtureResult> {
    this.single = true;
    return this.execute();
  }
  delete(): this {
    this.operation = 'delete';
    return this;
  }
  insert(value: Record<string, unknown>): this {
    this.operation = 'insert';
    this.row = value;
    return this;
  }
  upsert(value: Record<string, unknown>): this {
    this.operation = 'insert';
    this.row = value;
    this.conflict = true;
    return this;
  }
  then<TResult1 = LegacyFixtureResult, TResult2 = never>(
    resolve?: ((value: LegacyFixtureResult) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(resolve, reject);
  }
  private async execute(): Promise<LegacyFixtureResult> {
    const client = runtime.client as ReturnType<typeof postgres>;
    const where = this.filters.length
      ? ' where ' +
        this.filters
          .map((filter, index) => {
            if (!/^[a-z_]+$/.test(filter.key)) throw Error('Invalid fixture column');
            return filter.key + '=$' + (index + 1);
          })
          .join(' and ')
      : '';
    let rows;
    if (this.operation === 'select') {
      if (!/^[a-z_*, ]+$/.test(this.fields)) throw Error('Invalid fixture projection');
      rows = await client.unsafe(
        'select ' + this.fields + ' from ' + this.table + where,
        this.filters.map((f) => f.value),
      );
    } else if (this.operation === 'delete')
      rows = await client.unsafe(
        'delete from ' + this.table + where + ' returning *',
        this.filters.map((f) => f.value),
      );
    else if (this.conflict)
      rows =
        await client`insert into ${client(this.table)} ${client(this.row)} on conflict do nothing returning *`;
    else rows = await client`insert into ${client(this.table)} ${client(this.row)} returning *`;
    return { data: this.single ? (rows[0] ?? null) : rows, error: null };
  }
}
function legacyPostgrest(table: string) {
  return new LegacyFixtureQuery(table);
}
async function legacyFixture() {
  await db`update organizations set role_model='legacy',default_role_key=null where id=${org}`;
  await db`insert into permission_roles(key,name,rank) values('owner','Owner',100),('admin','Admin',80),('manager','Manager',60),('staff','Staff',40),('viewer','Viewer',20)`;
}
async function restrictLegacy(kind: 'module' | 'owner' | 'field' | 'page') {
  if (kind === 'module')
    await db`update permission_rules set can_view=false,can_create=false,can_edit=false,can_delete=false,can_export=false,can_manage=false where role_key='custom-administrator' and module='crm'`;
  else if (kind === 'owner')
    await db`update permission_rules set if_owner=true where role_key='custom-administrator' and module='crm'`;
  else if (kind === 'field')
    await db`update permission_rules set field_level=0 where role_key='custom-administrator' and module='crm'`;
  else
    await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)values(${org},'custom-administrator','page:/crm',false,false,false,false,false,false,false,0)`;
}
async function assignments(profileId = owner) {
  return db`select role_key from member_roles where org_id=${org} and profile_id=${profileId} order by role_key`;
}
const asset = '00000000-0000-4000-8000-000000000109';
async function privateBrain() {
  await db`insert into brains(id,org_id,name,visibility)values(${asset},${org},'Private asset','private')`;
}
async function brainVisible(profileId: string, level: 'read' | 'write' = 'write') {
  const state = await db.begin((tx) => readOrganizationAdminState(tx, org));
  const memberRow = state.members.find((row) => row.profile_id === profileId)!;
  const roles = resolveMemberRoleKeys(
    state.assignments.filter((row) => row.profile_id === profileId).map((row) => row.role_key),
    memberRow.role,
    state.policy.roleModel,
    state.roles.map((row) => row.key),
  );
  const capabilities = buildCapabilities(roles, state.rules);
  // Mirror the API's module gate before the actual object resolver.
  if (
    !capabilities.can('brains', 'view') ||
    (level === 'write' && !capabilities.can('brains', 'edit'))
  )
    return false;
  return runWithRequestCapabilities({ orgId: org, profileId, capabilities }, () =>
    canAccessBrain({ db: drizzle(db) as never, tenantId: org, profileId }, asset, level, {
      profileId,
      roles,
    }),
  );
}
async function personalBrainVisible(profileId: string, agentId: string) {
  const state = await db.begin((tx) => readOrganizationAdminState(tx, org));
  const m = state.members.find((row) => row.profile_id === profileId)!;
  const roles = resolveMemberRoleKeys(
    state.assignments.filter((row) => row.profile_id === profileId).map((row) => row.role_key),
    m.role,
    state.policy.roleModel,
    state.roles.map((row) => row.key),
  );
  const capabilities = buildCapabilities(roles, state.rules);
  return runWithRequestCapabilities({ orgId: org, profileId, capabilities }, async () => {
    const principal = await resolveAssistantPrincipal(
      { user: { supabaseId: profileId, role: 'user' } } as App.Locals,
      new URL(
        'http://localhost/api/gateway/brain-remember?orgId=' +
          org +
          '&agentId=' +
          encodeURIComponent(agentId),
      ),
    );
    expect(principal.principalId).toBe(profileId);
    if (!principal.capabilities.can('brains', 'edit')) return false;
    return canAccessBrain({ db: drizzle(db) as never, tenantId: org, profileId }, asset, 'write', {
      profileId,
      agentId,
      roles: principal.capabilities.roles,
    });
  });
}
async function hideRecipientBrains() {
  await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-hidden','Hidden Brains',80)`;
  await db`insert into permission_rules select org_id,'custom-hidden',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,updated_at from permission_rules where role_key='custom-administrator'`;
  await db`update permission_rules set can_view=false,can_create=false,can_edit=false,can_delete=false,can_export=false,can_manage=false where role_key='custom-hidden' and module='brains'`;
  await db`update member_roles set role_key='custom-hidden' where profile_id=${member}`;
}
async function assetRole(model: 'legacy' | 'organization') {
  if (model === 'legacy') await legacyFixture();
  await db`update permission_rules set can_manage=false where module='brains'`;
  await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-asset','Asset access',40)`;
  await db`insert into permission_rules select org_id,'custom-asset',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,updated_at from permission_rules where role_key='custom-administrator'`;
  await privateBrain();
  await db`insert into brain_access values(${asset},${org},'role','custom-asset','write')`;
}
async function dataUnionFixture(kind: 'field' | 'scope') {
  await db`update permission_rules set can_view=true,can_create=false,can_edit=${kind === 'scope'},can_delete=false,can_export=false,can_manage=false,if_owner=${kind === 'scope'},field_level=0 where role_key='custom-administrator' and module='crm'`;
  await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-retained','Retained metadata',40),(${org},'custom-granted','Granted CRM',40)`;
  await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)values(${org},'custom-retained','crm',${kind === 'scope'},false,false,false,false,false,false,${kind === 'field' ? 1 : 0}),(${org},'custom-granted','crm',true,false,${kind === 'scope'},false,false,false,${kind === 'scope'},0)`;
  await db`delete from member_roles where profile_id=${member}`;
  await db`insert into member_roles(org_id,profile_id,role_key)values(${org},${member},'custom-retained')`;
}
async function memberCaps(profileId = member) {
  const state = await db.begin((tx) => readOrganizationAdminState(tx, org));
  return memberAuthority(state, profileId).caps;
}
async function rankUnionFixture() {
  await legacyFixture();
  await db`update org_roles set rank=60 where key='custom-administrator'`;
  await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-high-rank','High rank without management',80),(${org},'custom-role-management','Role management',40),(${org},'custom-team-management','Team management',40),(${org},'custom-data-view','Data view',40)`;
  await db`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)values(${org},'custom-role-management','roles',true,true,true,true,false,false,false,0),(${org},'custom-team-management','users',true,false,false,false,false,true,false,0),(${org},'custom-data-view','crm',true,false,false,false,false,false,false,0)`;
  await db`delete from member_roles where profile_id=${member}`;
  await db`insert into member_roles(org_id,profile_id,role_key)values(${org},${member},'custom-high-rank')`;
}
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
   do $$begin if not exists(select 1 from pg_roles where rolname='app_ledger') then create role app_ledger nologin nobypassrls; end if; end$$;
   create table organizations(id uuid primary key,status text default 'active',role_model text,default_role_key text);
   create table profiles(id uuid primary key,role text default 'user',deletion_pending boolean default false);
   create table organization_members(organization_id uuid,profile_id uuid,role text,primary key(organization_id,profile_id));
   create table org_roles(org_id text,key text,name text,rank int,source_role_key text,created_by text,template_id text,template_version int,created_at timestamptz default now(),primary key(org_id,key));
   create table permission_roles(key text primary key,name text,rank int);
   create table member_roles(org_id uuid,profile_id uuid,role_key text,granted_by uuid,primary key(org_id,profile_id,role_key));
   create table permission_rules(org_id uuid,role_key text,module text,can_view boolean,can_create boolean,can_edit boolean,can_delete boolean,can_export boolean,can_manage boolean,if_owner boolean,field_level int,updated_at timestamptz,primary key(org_id,role_key,module));
   create table app_nav_config(org_id text primary key,value jsonb);
   create table doc_audit_log(id uuid default gen_random_uuid(),org_id text,ref_type text,ref_id uuid,actor_id uuid,actor_name text,simulation_role_key text,simulation_generation bigint,op text,changes jsonb,occurred_at timestamptz default now());
   create table brains(id uuid primary key,org_id text,name text,description text,icon text,visibility text,kind text default 'focused',include_all_sources boolean default false,agent_id text,created_by text,created_at timestamptz default now(),updated_at timestamptz default now());
   create table personal_agents(profile_id uuid unique,agent_id text);
   create table brain_access(brain_id uuid,org_id text,principal_type text,principal_id text,level text,primary key(brain_id,principal_type,principal_id));
   grant usage on schema public to app_ledger;
   grant select,insert,update,delete on brains,brain_access,doc_audit_log to app_ledger;
   alter table brains enable row level security;alter table brains force row level security;
   alter table brain_access enable row level security;alter table brain_access force row level security;
   alter table doc_audit_log enable row level security;alter table doc_audit_log force row level security;
   create policy org_scope on brains to app_ledger using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
   create policy org_scope on brain_access to app_ledger using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
   create policy org_scope on doc_audit_log to app_ledger using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
  `);
  }, 30000);
  beforeEach(async () => {
    runtime.postgrestCalls = 0;
    await db.unsafe(
      'truncate organizations,profiles,organization_members,org_roles,permission_roles,member_roles,permission_rules,app_nav_config,doc_audit_log,brains,brain_access,personal_agents',
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
  describe('legacy assignment grant ceilings', () => {
    it.each(['replace', 'add'] as const)(
      'blocks %s self-escalation across module, record, field and native-page ceilings',
      async (mode) => {
        await legacyFixture();
        for (const restriction of ['module', 'owner', 'field', 'page'] as const) {
          await db`delete from permission_rules where module='page:/crm'`;
          await db`update permission_rules set can_view=true,can_create=true,can_edit=true,can_delete=true,can_export=true,can_manage=true,if_owner=false,field_level=1 where module='crm'`;
          await restrictLegacy(restriction);
          const write = mode === 'replace' ? setMemberRole : addMemberRole;
          await expect(write(org, owner, 'admin', owner)).rejects.toMatchObject({ status: 403 });
          expect(await assignments()).toEqual([{ role_key: 'custom-administrator' }]);
          expect(await db`select * from doc_audit_log`).toHaveLength(0);
        }
      },
    );
    it.each(['module', 'page'] as const)(
      'blocks removal that exposes a legacy member-to-manager fallback beyond its %s ceiling',
      async (restriction) => {
        await legacyFixture();
        await db`update organization_members set role='member' where profile_id=${owner}`;
        await restrictLegacy(restriction);
        await expect(
          removeMemberRole(org, owner, 'custom-administrator', owner),
        ).rejects.toMatchObject({ status: 403 });
        expect(await assignments()).toEqual([{ role_key: 'custom-administrator' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it('allows a narrowing removal without granting the remaining target role to the caller', async () => {
      await legacyFixture();
      await restrictLegacy('module');
      await db`delete from member_roles where profile_id=${member}`;
      await db`insert into member_roles(org_id,profile_id,role_key) values(${org},${member},'admin'),(${org},${member},'staff')`;
      await removeMemberRole(org, member, 'admin', owner);
      expect(await assignments(member)).toEqual([{ role_key: 'staff' }]);
      expect(await db`select * from doc_audit_log`).toHaveLength(1);
      expect(runtime.postgrestCalls).toBe(0);
    });
    it.each(['replace', 'remove'] as const)(
      'protects the final explicit legacy owner during %s',
      async (mode) => {
        await legacyFixture();
        await db`update member_roles set role_key='owner' where profile_id=${owner}`;
        const action =
          mode === 'replace'
            ? setMemberRole(org, owner, 'viewer', owner)
            : removeMemberRole(org, owner, 'owner', owner);
        await expect(action).rejects.toMatchObject({ status: 400 });
        expect(await assignments()).toEqual([{ role_key: 'owner' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it('rolls back replacement deletion when the new role insert fails', async () => {
      await legacyFixture();
      await db.unsafe(
        "create function reject_assignment_fixture()returns trigger language plpgsql as $$begin if new.role_key='viewer' then raise exception 'Assignment fixture insert failed'; end if;return new;end$$;create trigger reject_assignment_fixture before insert on member_roles for each row execute function reject_assignment_fixture()",
      );
      try {
        await expect(setMemberRole(org, member, 'viewer', owner)).rejects.toThrow(
          'Assignment fixture insert failed',
        );
        expect(await assignments(member)).toEqual([{ role_key: 'custom-administrator' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      } finally {
        await db.unsafe(
          'drop trigger reject_assignment_fixture on member_roles;drop function reject_assignment_fixture()',
        );
      }
    });
    it.each(['actual-module', 'actual-rank', 'simulated-module'] as const)(
      'revalidates %s revoked after simulation admission before assigning',
      async (revocation) => {
        await legacyFixture();
        await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-simulation','Simulation',80)`;
        await db`insert into permission_rules select org_id,'custom-simulation',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,updated_at from permission_rules where role_key='custom-administrator'`;
        const rules = await db<CapabilityOverrideRow[]>`select * from permission_rules`;
        const capabilities = buildCapabilities(['custom-simulation'], [...rules]);
        if (revocation === 'actual-module') await restrictLegacy('module');
        else if (revocation === 'actual-rank')
          await db`update org_roles set rank=40 where key='custom-administrator'`;
        else
          await db`update permission_rules set can_view=false,can_create=false,can_edit=false,can_delete=false,can_export=false,can_manage=false where role_key='custom-simulation' and module='crm'`;
        await expect(
          runWithEffectiveAuthority(
            {
              orgId: org,
              profileId: owner,
              roleKey: 'custom-simulation',
              generation: '1',
              rank: 80,
              invalid: false,
              capabilities,
            },
            () => setMemberRole(org, member, 'admin', owner),
          ),
        ).rejects.toMatchObject({ status: 403 });
        expect(await assignments(member)).toEqual([{ role_key: 'custom-administrator' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it('preserves an explicit internal system assignment without accepting simulated delegation', async () => {
      await legacyFixture();
      await setMemberRole(org, member, 'admin', null, true);
      expect(await assignments(member)).toEqual([{ role_key: 'admin' }]);
      const capabilities = buildCapabilities(['viewer'], []);
      await expect(
        runWithEffectiveAuthority(
          {
            orgId: org,
            profileId: owner,
            roleKey: 'viewer',
            generation: '1',
            rank: 20,
            invalid: false,
            capabilities,
          },
          () => addMemberRole(org, member, 'owner', null, true),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(await assignments(member)).toEqual([{ role_key: 'admin' }]);
    });
    it.each(['grantor', 'target'] as const)(
      'rejects a legacy assignment while the %s profile is pending deletion',
      async (pending) => {
        await legacyFixture();
        await db`update profiles set deletion_pending=true where id=${pending === 'grantor' ? owner : member}`;
        await expect(setMemberRole(org, member, 'viewer', owner)).rejects.toMatchObject({
          status: 403,
        });
        expect(await assignments(member)).toEqual([{ role_key: 'custom-administrator' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it('adds an authorized legacy role idempotently without replacing existing assignments', async () => {
      await legacyFixture();
      await addMemberRole(org, member, 'viewer', owner);
      await addMemberRole(org, member, 'viewer', owner);
      expect(await assignments(member)).toEqual([
        { role_key: 'custom-administrator' },
        { role_key: 'viewer' },
      ]);
      expect(runtime.postgrestCalls).toBe(0);
    });
    it('assigns a valid legacy role atomically and keeps the role model and global catalog intact', async () => {
      await legacyFixture();
      await setMemberRole(org, member, 'staff', owner);
      expect(await assignments(member)).toEqual([{ role_key: 'staff' }]);
      expect(await db`select role_model from organizations`).toEqual([{ role_model: 'legacy' }]);
      expect(await db`select * from permission_roles`).toHaveLength(5);
      expect(await db`select * from doc_audit_log`).toHaveLength(1);
      expect(runtime.postgrestCalls).toBe(0);
    });
  });
  describe('recipient role union data deltas', () => {
    it.each(['custom-role-management', 'custom-team-management'])(
      'does not lend retained rank80 through a new %s grant from rank60',
      async (key) => {
        await rankUnionFixture();
        await expect(addMemberRole(org, member, key, owner)).rejects.toMatchObject({ status: 403 });
        expect(await assignments(member)).toEqual([{ role_key: 'custom-high-rank' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it('allows a data-only grant to a recipient with retained higher rank but no new management actions', async () => {
      await rankUnionFixture();
      await addMemberRole(org, member, 'custom-data-view', owner);
      expect((await memberCaps()).can('crm', 'view')).toBe(true);
      expect((await memberCaps()).can('users', 'manage')).toBe(false);
      expect((await memberCaps()).can('roles', 'edit')).toBe(false);
    });
    it('allows replacing the retained high rank with management bounded by the grantor rank', async () => {
      await rankUnionFixture();
      await setMemberRole(org, member, 'custom-role-management', owner);
      expect(await assignments(member)).toEqual([{ role_key: 'custom-role-management' }]);
    });
    it('does not activate hidden PII metadata through an otherwise masked role grant', async () => {
      await dataUnionFixture('field');
      expect((await memberCaps()).can('crm', 'view')).toBe(false);
      await expect(addMemberRole(org, member, 'custom-granted', owner)).rejects.toMatchObject({
        status: 403,
      });
      expect((await memberCaps()).can('crm', 'view')).toBe(false);
      expect(await assignments(member)).toEqual([{ role_key: 'custom-retained' }]);
      expect(await db`select * from doc_audit_log`).toHaveLength(0);
    });
    it('does not combine unrestricted read with a newly granted owner-only edit into unrestricted edits', async () => {
      await dataUnionFixture('scope');
      expect((await memberCaps()).ownerScoped('crm')).toBe(false);
      expect((await memberCaps()).can('crm', 'edit')).toBe(false);
      await expect(addMemberRole(org, member, 'custom-granted', owner)).rejects.toMatchObject({
        status: 403,
      });
      expect((await memberCaps()).can('crm', 'edit')).toBe(false);
      expect(await assignments(member)).toEqual([{ role_key: 'custom-retained' }]);
      expect(await db`select * from doc_audit_log`).toHaveLength(0);
    });
    it.each(['field', 'scope'] as const)(
      'permits a replacement that removes conflicting retained %s metadata',
      async (kind) => {
        await dataUnionFixture(kind);
        await setMemberRole(org, member, 'custom-granted', owner);
        const caps = await memberCaps();
        expect(caps.can('crm', 'view')).toBe(true);
        expect(caps.fieldLevel('crm')).toBe(0);
        expect(caps.ownerScoped('crm')).toBe(kind === 'scope');
        expect(await assignments(member)).toEqual([{ role_key: 'custom-granted' }]);
      },
    );
    it.each(['field', 'scope'] as const)(
      'caps the %s union by the fresh simulation even if the real actor could grant it',
      async (kind) => {
        await dataUnionFixture(kind);
        await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-data-simulation','Data simulation',80)`;
        await db`insert into permission_rules select org_id,'custom-data-simulation',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,updated_at from permission_rules where role_key='custom-administrator'`;
        const rows = await db<CapabilityOverrideRow[]>`select * from permission_rules`;
        const capabilities = buildCapabilities(['custom-data-simulation'], [...rows]);
        if (kind === 'field')
          await db`update permission_rules set field_level=1 where role_key='custom-administrator' and module='crm'`;
        else
          await db`update permission_rules set if_owner=false where role_key='custom-administrator' and module='crm'`;
        await expect(
          runWithEffectiveAuthority(
            {
              orgId: org,
              profileId: owner,
              roleKey: 'custom-data-simulation',
              generation: '1',
              rank: 80,
              invalid: false,
              capabilities,
            },
            () => addMemberRole(org, member, 'custom-granted', owner),
          ),
        ).rejects.toMatchObject({ status: 403 });
        expect(await assignments(member)).toEqual([{ role_key: 'custom-retained' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it.each(['field', 'scope'] as const)(
      'permits the %s union when the actor holds the resulting authority',
      async (kind) => {
        await dataUnionFixture(kind);
        if (kind === 'field')
          await db`update permission_rules set field_level=1 where role_key='custom-administrator' and module='crm'`;
        else
          await db`update permission_rules set if_owner=false where role_key='custom-administrator' and module='crm'`;
        await addMemberRole(org, member, 'custom-granted', owner);
        const caps = await memberCaps();
        expect(caps.can('crm', 'view')).toBe(true);
        expect(kind === 'field' ? caps.fieldLevel('crm') : Number(caps.ownerScoped('crm'))).toBe(
          kind === 'field' ? 1 : 0,
        );
      },
    );
  });
  describe('role-linked Brain delegation', () => {
    it.each(['brains', 'access'] as const)(
      'fails closed before role creation when the bounded Brain %s snapshot overflows',
      async (bound) => {
        if (bound === 'brains')
          await db`insert into brains(id,org_id,name,visibility)select gen_random_uuid(),${org},'Bounded asset','private' from generate_series(1,4097)`;
        else {
          await privateBrain();
          await db`insert into brain_access(brain_id,org_id,principal_type,principal_id,level)select ${asset}::uuid,${org},'user',gen_random_uuid()::text,'read' from generate_series(1,65537)`;
        }
        await expect(
          createOrganizationRole(locals, { source: 'blank', name: 'Bounded role' }),
        ).rejects.toMatchObject({ status: 503 });
        expect(await db`select * from org_roles where key='custom-bounded-role'`).toHaveLength(0);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it('denies custom full80 to legacy admin80 private-Brain bypass even with no current assets', async () => {
      await legacyFixture();
      await expect(setMemberRole(org, owner, 'admin', owner)).rejects.toMatchObject({
        status: 403,
      });
      await privateBrain();
      expect(await brainVisible(owner)).toBe(false);
      await expect(setMemberRole(org, owner, 'admin', owner)).rejects.toMatchObject({
        status: 403,
      });
      expect(await brainVisible(owner)).toBe(false);
      expect(await assignments()).toEqual([{ role_key: 'custom-administrator' }]);
    });
    it.each(['legacy', 'organization'] as const)(
      'denies a %s role ACL the real actor cannot access',
      async (model) => {
        await assetRole(model);
        expect(await brainVisible(owner)).toBe(false);
        expect(await brainVisible(member)).toBe(false);
        await expect(setMemberRole(org, member, 'custom-asset', owner)).rejects.toMatchObject({
          status: 403,
        });
        expect(await brainVisible(member)).toBe(false);
        expect(await assignments(member)).toEqual([{ role_key: 'custom-administrator' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it.each(['read', 'write'] as const)(
      'permits a held %s object grant and proves the assigned member can access it',
      async (level) => {
        await assetRole('organization');
        await db`update brain_access set level=${level} where principal_type='role'`;
        await db`insert into brain_access values(${asset},${org},'user',${owner},${level})`;
        expect(await brainVisible(owner, level)).toBe(true);
        expect(await brainVisible(member, level)).toBe(false);
        await setMemberRole(org, member, 'custom-asset', owner);
        expect(await brainVisible(member, level)).toBe(true);
        expect(await assignments(member)).toEqual([{ role_key: 'custom-asset' }]);
      },
    );
    it('checks equal-matrix and equal-rank fallback object effects on legacy removal', async () => {
      await legacyFixture();
      await db`update organization_members set role='admin' where profile_id=${owner}`;
      await privateBrain();
      expect(await brainVisible(owner)).toBe(false);
      await expect(
        removeMemberRole(org, owner, 'custom-administrator', owner),
      ).rejects.toMatchObject({ status: 403 });
      expect(await brainVisible(owner)).toBe(false);
      expect(await assignments()).toEqual([{ role_key: 'custom-administrator' }]);
    });
    it('checks fresh simulation object scope independently from the real actor', async () => {
      await assetRole('legacy');
      await db`delete from member_roles where profile_id=${owner}`;
      await db`insert into member_roles(org_id,profile_id,role_key) values(${org},${owner},'admin')`;
      const rows = await db<CapabilityOverrideRow[]>`select * from permission_rules`;
      const capabilities = buildCapabilities(['custom-administrator'], [...rows]);
      expect(await brainVisible(owner)).toBe(true);
      await expect(
        runWithEffectiveAuthority(
          {
            orgId: org,
            profileId: owner,
            roleKey: 'custom-administrator',
            generation: '1',
            rank: 80,
            invalid: false,
            capabilities,
          },
          () => setMemberRole(org, member, 'custom-asset', owner),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(await brainVisible(member)).toBe(false);
    });
    it('does not reuse a deleted role key to restore a private Brain ACL', async () => {
      await assetRole('organization');
      await db`delete from permission_rules where role_key='custom-asset'`;
      await db`delete from org_roles where key='custom-asset'`;
      await expect(
        createOrganizationRole(locals, { source: 'blank', name: 'Asset' }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await db`select * from org_roles where key='custom-asset'`).toHaveLength(0);
    });
    it.each(['user', 'creator'] as const)(
      'denies a role assignment that reactivates recipient %s access beyond the grantor',
      async (kind) => {
        await assetRole('organization');
        await db`delete from brain_access`;
        await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-hidden','Hidden Brains',80)`;
        await db`insert into permission_rules select org_id,'custom-hidden',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,updated_at from permission_rules where role_key='custom-administrator'`;
        await db`update permission_rules set can_view=false,can_create=false,can_edit=false,can_delete=false,can_export=false,can_manage=false where role_key='custom-hidden' and module='brains'`;
        await db`update member_roles set role_key='custom-hidden' where profile_id=${member}`;
        if (kind === 'user')
          await db`insert into brain_access values(${asset},${org},'user',${member},'write')`;
        else await db`update brains set created_by=${member} where id=${asset}`;
        expect(await brainVisible(member)).toBe(false);
        expect(await brainVisible(owner)).toBe(false);
        await expect(setMemberRole(org, member, 'custom-asset', owner)).rejects.toMatchObject({
          status: 403,
        });
        expect(await brainVisible(member)).toBe(false);
        expect(await assignments(member)).toEqual([{ role_key: 'custom-hidden' }]);
        expect(await db`select * from doc_audit_log`).toHaveLength(0);
      },
    );
    it.each(['user', 'creator'] as const)(
      'allows recipient %s reactivation when the grantor holds matching object rights',
      async (kind) => {
        await assetRole('organization');
        await db`delete from brain_access`;
        await db`insert into org_roles(org_id,key,name,rank)values(${org},'custom-hidden','Hidden Brains',80)`;
        await db`insert into permission_rules select org_id,'custom-hidden',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,updated_at from permission_rules where role_key='custom-administrator'`;
        await db`update permission_rules set can_view=false,can_create=false,can_edit=false,can_delete=false,can_export=false,can_manage=false where role_key='custom-hidden' and module='brains'`;
        await db`update member_roles set role_key='custom-hidden' where profile_id=${member}`;
        await db`insert into brain_access values(${asset},${org},'user',${owner},'write')`;
        if (kind === 'user')
          await db`insert into brain_access values(${asset},${org},'user',${member},'write')`;
        else await db`update brains set created_by=${member} where id=${asset}`;
        expect(await brainVisible(member)).toBe(false);
        await setMemberRole(org, member, 'custom-asset', owner);
        expect(await brainVisible(member)).toBe(true);
      },
    );
    it.each([false, true])(
      'checks verified case-folded owned-agent write activation with grantor access=%s',
      async (held) => {
        await assetRole('organization');
        await db`delete from brain_access`;
        await hideRecipientBrains();
        await db`insert into personal_agents values(${member},'Personal-Member')`;
        await db`insert into brain_access values(${asset},${org},'agent','personal-member','write')`;
        if (held)
          await db`insert into brain_access values(${asset},${org},'user',${owner},'write')`;
        expect(await personalBrainVisible(member, 'personal-member')).toBe(false);
        if (held) {
          await setMemberRole(org, member, 'custom-asset', owner);
          expect(await personalBrainVisible(member, 'personal-member')).toBe(true);
        } else {
          await expect(setMemberRole(org, member, 'custom-asset', owner)).rejects.toMatchObject({
            status: 403,
          });
          expect(await personalBrainVisible(member, 'personal-member')).toBe(false);
          expect(await assignments(member)).toEqual([{ role_key: 'custom-hidden' }]);
        }
      },
    );
    it("does not credit another profile's agent ACL to the recipient", async () => {
      await assetRole('organization');
      await db`delete from brain_access`;
      await hideRecipientBrains();
      await db`insert into personal_agents values(${owner},'personal-other')`;
      await db`insert into brain_access values(${asset},${org},'agent','personal-other','write')`;
      await setMemberRole(org, member, 'custom-asset', owner);
      expect(await brainVisible(member)).toBe(false);
      await expect(personalBrainVisible(member, 'personal-other')).rejects.toMatchObject({
        status: 403,
      });
    });
    it('fails closed for an ambiguous case-insensitive personal-agent identity', async () => {
      await assetRole('organization');
      await db`delete from brain_access`;
      await hideRecipientBrains();
      await db`insert into personal_agents values(${owner},'Personal-Ambiguous'),(${member},'personal-ambiguous')`;
      await db`insert into brain_access values(${asset},${org},'agent','personal-ambiguous','write')`;
      await expect(setMemberRole(org, member, 'custom-asset', owner)).rejects.toMatchObject({
        status: 503,
      });
      expect(await assignments(member)).toEqual([{ role_key: 'custom-hidden' }]);
      await expect(personalBrainVisible(member, 'personal-ambiguous')).rejects.toMatchObject({
        status: 400,
      });
    });
    it('revalidates a revoked object grant after acquiring the organization lock', async () => {
      await assetRole('organization');
      await db`insert into brain_access values(${asset},${org},'user',${owner},'write')`;
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const revoke = db.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${org},112))`;
        await tx`select id from brains where id=${asset} for update`;
        await tx`delete from brain_access where principal_type='user' and principal_id=${owner}`;
        acquired();
        await barrier;
      });
      await locked;
      const denial = expect(
        setMemberRole(org, member, 'custom-asset', owner),
      ).rejects.toMatchObject({ status: 403 });
      release();
      await revoke;
      await denial;
      expect(await brainVisible(member)).toBe(false);
      expect(await assignments(member)).toEqual([{ role_key: 'custom-administrator' }]);
    });
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
