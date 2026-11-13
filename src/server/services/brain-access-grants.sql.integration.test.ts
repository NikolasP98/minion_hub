import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { CoreCtx } from '$server/auth/core-ctx';
const runtime = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => runtime.client }));
vi.mock('./permissions.service', () => ({ capsToLegacyPermissions: () => [] }));
vi.mock('./embeddings', () => ({ embeddingsEnabled: () => false }));
vi.mock('./crm-contacts.service', () => ({}));
vi.mock('./stock.service', () => ({}));
vi.mock('./finance-products.service', () => ({}));
vi.mock('./bg-runtime', () => ({ registerJobHandler: () => {} }));
vi.mock('./job-effects.service', () => ({}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: vi.fn() }));
import { gatewayCall } from '$lib/server/gateway-rpc';
import { provisionBrainAgent, deprovisionBrainAgent } from './brain-agents.service';
import { setAccess, updateBrain } from './brains.service';
import { buildCapabilities } from './rbac.service';
import { runWithEffectiveAuthority } from '$server/auth/effective-authority';
const enabled = !!process.env.HUB_TEST_DB_URL;
if (process.env.REQUIRE_ORG_ROLES_POSTGRES === '1' && !enabled)
  throw Error('HUB_TEST_DB_URL required');
const suite = enabled ? describe : describe.skip;
const org = '00000000-0000-4000-8000-000000000201',
  actor = '00000000-0000-4000-8000-000000000202',
  recipient = '00000000-0000-4000-8000-000000000203',
  brain = '00000000-0000-4000-8000-000000000204';
let admin: ReturnType<typeof postgres>,
  db: ReturnType<typeof postgres>,
  database: string,
  ctx: CoreCtx;
const principal = { profileId: actor, roles: ['owner'] }; // Untrusted caller role never grants authority.
const grants = [
  { principalType: 'user' as const, principalId: recipient, level: 'write' as const },
];
suite('brain grant boundaries (native PostgreSQL)', () => {
  beforeAll(async () => {
    const url = new URL(process.env.HUB_TEST_DB_URL!);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
      throw Error('Loopback database required');
    admin = postgres(url.toString(), { max: 1 });
    database = 'role113_brain_' + process.pid + '_' + Date.now();
    await admin`create database ${admin(database)}`;
    url.pathname = '/' + database;
    db = postgres(url.toString(), { max: 3 });
    runtime.client = db;
    ctx = { db: drizzle(db) as CoreCtx['db'], tenantId: org, profileId: actor };
    await db.unsafe(`
      do $$begin if not exists(select 1 from pg_roles where rolname='app_ledger') then create role app_ledger nologin nobypassrls; end if; end$$;
      create table organizations(id uuid primary key,status text default 'active',role_model text,default_role_key text);
      create table profiles(id uuid primary key,deletion_pending boolean default false);
      create table organization_members(organization_id uuid,profile_id uuid,role text);
      create table member_roles(org_id uuid,profile_id uuid,role_key text);
      create table org_roles(org_id text,key text);
      create table permission_roles(key text);
      create table permission_rules(org_id uuid,role_key text,module text,can_view boolean,can_create boolean,can_edit boolean,can_delete boolean,can_export boolean,can_manage boolean,if_owner boolean,field_level int);
      create table brains(id uuid primary key,org_id text,name text,description text,icon text,visibility text,kind text default 'focused',include_all_sources boolean default false,agent_id text,created_by text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table brain_access(brain_id uuid,org_id text,principal_type text,principal_id text,level text,primary key(brain_id,principal_type,principal_id));
      create table doc_audit_log(id uuid default gen_random_uuid(),org_id text,ref_type text,ref_id uuid,actor_id uuid,actor_name text,simulation_role_key text,simulation_generation bigint,op text,changes jsonb,occurred_at timestamptz default now());
      create table brain_agent_templates(id uuid,name_prefix text,org_id text,emoji text,model text,instructions text,created_at timestamptz,updated_at timestamptz);
      grant select on brain_agent_templates to app_ledger;
      alter table brain_agent_templates enable row level security; alter table brain_agent_templates force row level security;
      create policy org_scope on brain_agent_templates to app_ledger using(org_id=current_setting('app.current_org_id',true));
      create table built_agents(id text,tenant_id uuid,runtime_agent_id text);
      create table gateway(id uuid,org_id uuid);
      create table personal_agents(profile_id uuid,agent_id text,gateway_id uuid);
      create table user_agents(user_id uuid,agent_id text,gateway_id uuid);
      grant usage on schema public to app_ledger;
      grant select,insert,update,delete on brains,brain_access,doc_audit_log to app_ledger;
      alter table brains enable row level security; alter table brains force row level security;
      alter table brain_access enable row level security; alter table brain_access force row level security;
      alter table doc_audit_log enable row level security; alter table doc_audit_log force row level security;
      create policy org_scope on brains to app_ledger using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
      create policy org_scope on brain_access to app_ledger using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
      create policy org_scope on doc_audit_log to app_ledger using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
    `);
  }, 30000);
  beforeEach(async () => {
    vi.mocked(gatewayCall)
      .mockReset()
      .mockImplementation(async (method) =>
        method === 'config.get' ? { hash: 'fixture' } : { ok: true },
      );
    await db.unsafe(
      'truncate organizations,profiles,organization_members,member_roles,org_roles,permission_roles,permission_rules,brains,brain_access,doc_audit_log,brain_agent_templates,built_agents,gateway,personal_agents,user_agents',
    );
    await db`insert into organizations values(${org},'active','organization','custom-writer')`;
    await db`insert into profiles(id) values(${actor}),(${recipient})`;
    await db`insert into organization_members values(${org},${actor},'owner'),(${org},${recipient},'member')`;
    await db`insert into org_roles values(${org},'custom-writer'),(${org},'custom-recipient')`;
    await db`insert into member_roles values(${org},${actor},'custom-writer')`;
    await db`insert into permission_rules values(${org},'custom-writer','brains',true,true,true,false,false,false,false,0)`;
    await db`insert into brains(id,org_id,name,visibility,created_by) values(${brain},${org},'Private','private',${recipient})`;
    await db`insert into brain_access values(${brain},${org},'user',${actor},'write')`;
  });
  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      await admin`drop database if exists ${admin(database)} with(force)`;
      await admin.end();
    }
  });
  it('enforces the native non-bypass role against unfiltered foreign reads', async () => {
    const [role] = await db`select rolbypassrls,rolsuper from pg_roles where rolname='app_ledger'`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    await db`insert into brains(id,org_id,name,visibility) values('00000000-0000-4000-8000-000000000299','foreign-org','Foreign','org')`;
    const visible = await db.begin(async (tx) => {
      await tx`select set_config('role','app_ledger',true),set_config('app.current_org_id',${org},true)`;
      return tx`select name from brains`;
    });
    expect(visible).toEqual([{ name: 'Private' }]);
  });
  it('replaces local grants under real app_ledger RLS and audits the authenticated actor', async () => {
    await setAccess(ctx, brain, grants, principal);
    expect(await db`select principal_id,level from brain_access`).toEqual([
      { principal_id: recipient, level: 'write' },
    ]);
    expect(await db`select actor_id,op from doc_audit_log`).toEqual([
      { actor_id: actor, op: 'permission' },
    ]);
  });
  it('does not trust claimed owner roles or Team management without current object write', async () => {
    await db`update brain_access set level='read'`;
    await db`insert into permission_rules values(${org},'custom-writer','users',true,true,true,true,true,true,false,0)`;
    await expect(setAccess(ctx, brain, grants, principal)).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from doc_audit_log`).toHaveLength(0);
  });
  it('honors current module ownership limits on a shared private brain', async () => {
    await db`update permission_rules set if_owner=true where module='brains'`;
    await expect(setAccess(ctx, brain, grants, principal)).rejects.toMatchObject({ status: 403 });
    expect(await db`select principal_id from brain_access`).toEqual([{ principal_id: actor }]);
  });
  it.each(['user', 'role', 'agent'] as const)(
    'rejects foreign %s recipients before deleting existing ACL',
    async (type) => {
      const id = type === 'user' ? '00000000-0000-4000-8000-000000000999' : 'custom-foreign';
      await expect(
        setAccess(ctx, brain, [{ principalType: type, principalId: id, level: 'read' }], principal),
      ).rejects.toMatchObject({ status: 400 });
      expect(await db`select principal_id from brain_access`).toEqual([{ principal_id: actor }]);
    },
  );
  it('accepts exact local role and registered agent recipients', async () => {
    await db`insert into built_agents values('agent-local',${org},'runtime-local')`;
    await setAccess(
      ctx,
      brain,
      [
        { principalType: 'role', principalId: 'custom-recipient', level: 'read' },
        { principalType: 'agent', principalId: 'runtime-local', level: 'read' },
      ],
      principal,
    );
    expect(await db`select * from brain_access`).toHaveLength(2);
  });
  it('rejects module edits revoked after a simulation was admitted', async () => {
    const caps = buildCapabilities(
      ['custom-writer'],
      [
        {
          role_key: 'custom-writer',
          module: 'brains',
          can_view: true,
          can_create: true,
          can_edit: true,
          can_delete: false,
          can_manage: false,
          can_export: false,
          if_owner: false,
          field_level: 0,
        },
      ],
    );
    await db`insert into org_roles values(${org},'custom-simulation')`;
    await db`insert into permission_rules select org_id,'custom-simulation',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level from permission_rules where role_key='custom-writer'`;
    await db`update permission_rules set can_edit=false where role_key='custom-writer'`;
    await expect(
      runWithEffectiveAuthority(
        {
          orgId: org,
          profileId: actor,
          roleKey: 'custom-simulation',
          generation: '1',
          rank: 40,
          invalid: false,
          capabilities: caps,
        },
        () => setAccess(ctx, brain, grants, principal),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('fails closed when a simulated organization-local role disappears', async () => {
    const caps = buildCapabilities(
      ['custom-writer'],
      [
        {
          role_key: 'custom-writer',
          module: 'brains',
          can_view: true,
          can_create: true,
          can_edit: true,
          can_delete: false,
          can_manage: false,
          can_export: false,
          if_owner: false,
          field_level: 0,
        },
      ],
    );
    await db`insert into permission_rules select org_id,'custom-removed',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level from permission_rules where role_key='custom-writer'`;
    await expect(
      runWithEffectiveAuthority(
        {
          orgId: org,
          profileId: actor,
          roleKey: 'custom-removed',
          generation: '1',
          rank: 40,
          invalid: false,
          capabilities: caps,
        },
        () => setAccess(ctx, brain, grants, principal),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select * from doc_audit_log`).toHaveLength(0);
  });
  it('does not let simulation use an object grant removed from the real actor', async () => {
    const caps = buildCapabilities(
      ['custom-writer'],
      [
        {
          role_key: 'custom-writer',
          module: 'brains',
          can_view: true,
          can_create: true,
          can_edit: true,
          can_delete: false,
          can_manage: false,
          can_export: false,
          if_owner: false,
          field_level: 0,
        },
      ],
    );
    await db`insert into org_roles values(${org},'custom-simulation')`;
    await db`insert into permission_rules select org_id,'custom-simulation',module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level from permission_rules where role_key='custom-writer'`;
    await db`delete from brain_access where principal_id=${actor}`;
    await db`insert into brain_access values(${brain},${org},'role','custom-simulation','write')`;
    await expect(
      runWithEffectiveAuthority(
        {
          orgId: org,
          profileId: actor,
          roleKey: 'custom-simulation',
          generation: '1',
          rank: 40,
          invalid: false,
          capabilities: caps,
        },
        () => setAccess(ctx, brain, grants, principal),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('requires current manage authority even for an idempotent managed-agent lookup', async () => {
    await db`update brains set agent_id=${'brain-' + brain}`;
    await expect(
      provisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(gatewayCall).not.toHaveBeenCalled();
  });
  it('provisions outside SQL locks, then binds and audits once under current authority', async () => {
    await db`update permission_rules set can_manage=true where module='brains'`;
    vi.mocked(gatewayCall).mockImplementation(async (method) => {
      await db.begin(async (tx) => {
        const [lock] =
          await tx`select pg_try_advisory_xact_lock(hashtextextended(${org},112)) as acquired`;
        expect(lock.acquired).toBe(true);
        await tx`select id from brains where id=${brain} for update nowait`;
      });
      return method === 'config.get' ? { hash: 'fixture' } : { ok: true };
    });
    expect(await provisionBrainAgent(ctx, brain, { id: recipient, name: 'Manager' })).toEqual({
      agentId: 'brain-' + brain,
    });
    expect(
      await db`select principal_id,level from brain_access where principal_type='agent'`,
    ).toEqual([{ principal_id: 'brain-' + brain, level: 'write' }]);
    expect(await db`select actor_id from doc_audit_log`).toEqual([{ actor_id: actor }]);
    vi.mocked(gatewayCall).mockClear();
    expect(await provisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' })).toEqual({
      agentId: 'brain-' + brain,
    });
    expect(gatewayCall).not.toHaveBeenCalled();
    expect(await db`select * from doc_audit_log`).toHaveLength(1);
  });
  it('denies a grant revoked during remote setup and safely retries a partial remote success', async () => {
    await db`update permission_rules set can_manage=true where module='brains'`;
    vi.mocked(gatewayCall).mockImplementation(async (method) => {
      if (method === 'config.patch')
        await db`update permission_rules set can_manage=false where module='brains'`;
      return method === 'config.get' ? { hash: 'fixture' } : { ok: true };
    });
    await expect(
      provisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select agent_id from brains`).toEqual([{ agent_id: null }]);
    expect(await db`select * from brain_access where principal_type='agent'`).toHaveLength(0);
    expect(await db`select * from doc_audit_log`).toHaveLength(0);
    await db`update permission_rules set can_manage=true where module='brains'`;
    vi.mocked(gatewayCall).mockImplementation(async (method) => {
      if (method === 'agents.create') throw Error('agent already exists');
      return method === 'config.get' ? { hash: 'fixture' } : { ok: true };
    });
    await expect(provisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' })).resolves.toEqual({
      agentId: 'brain-' + brain,
    });
    expect(await db`select * from brain_access where principal_type='agent'`).toHaveLength(1);
    expect(await db`select * from doc_audit_log`).toHaveLength(1);
  });
  it('does not bind or grant an agent when remote configuration fails', async () => {
    await db`update permission_rules set can_manage=true where module='brains'`;
    vi.mocked(gatewayCall).mockImplementation(async (method) => {
      if (method === 'config.patch') throw Error('gateway offline');
      return method === 'config.get' ? { hash: 'fixture' } : { ok: true };
    });
    await expect(provisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' })).rejects.toThrow(
      'gateway offline',
    );
    expect(await db`select agent_id from brains`).toEqual([{ agent_id: null }]);
    expect(await db`select * from brain_access where principal_type='agent'`).toHaveLength(0);
  });
  it('rechecks actual removal after remote delete and retries a not-found remote result', async () => {
    await db`update permission_rules set can_manage=true where module='brains'`;
    await provisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' });
    vi.mocked(gatewayCall).mockImplementation(async (method) => {
      if (method === 'agents.delete')
        await db`update permission_rules set can_manage=false where module='brains'`;
      return { ok: true };
    });
    await expect(
      deprovisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db`select agent_id from brains`).toEqual([{ agent_id: 'brain-' + brain }]);
    expect(await db`select * from brain_access where principal_type='agent'`).toHaveLength(1);
    await db`update permission_rules set can_manage=true where module='brains'`;
    vi.mocked(gatewayCall).mockRejectedValue(Error('agent not found'));
    await deprovisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' });
    expect(await db`select agent_id from brains`).toEqual([{ agent_id: null }]);
    expect(await db`select * from brain_access where principal_type='agent'`).toHaveLength(0);
    expect(await db`select * from doc_audit_log`).toHaveLength(2);
    vi.mocked(gatewayCall).mockClear();
    await deprovisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' });
    expect(gatewayCall).not.toHaveBeenCalled();
  });
  it('rejects a stale deprovision finalizer when the current binding changed during RPC', async () => {
    await db`update permission_rules set can_manage=true where module='brains'`;
    await provisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' });
    vi.mocked(gatewayCall).mockImplementation(async () => {
      await db`update brains set agent_id='replacement-agent' where id=${brain}`;
      return { ok: true };
    });
    await expect(
      deprovisionBrainAgent(ctx, brain, { id: actor, name: 'Manager' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db`select agent_id from brains`).toEqual([{ agent_id: 'replacement-agent' }]);
    expect(await db`select * from brain_access where principal_type='agent'`).toHaveLength(1);
    expect(await db`select * from doc_audit_log`).toHaveLength(1);
  });
  it.each(['share', 'visibility'] as const)(
    'a committed revocation wins against waiting %s grant',
    async (operation) => {
      let locked!: () => void, release!: () => void;
      const acquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const revoke = db.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${org},112))`;
        await tx`select id from brains where id=${brain} for update`;
        await tx`delete from brain_access where brain_id=${brain}`;
        locked();
        await barrier;
      });
      await acquired;
      const pending =
        operation === 'share'
          ? setAccess(ctx, brain, grants, principal)
          : updateBrain(ctx, brain, { visibility: 'org' }, principal, {
              id: actor,
              name: 'Writer',
            });
      const outcome = expect(pending).rejects.toMatchObject({ status: 403 });
      release();
      await revoke;
      await outcome;
      expect(await db`select visibility from brains`).toEqual([{ visibility: 'private' }]);
      expect(await db`select * from brain_access`).toHaveLength(0);
      expect(await db`select * from doc_audit_log`).toHaveLength(0);
    },
  );
});
