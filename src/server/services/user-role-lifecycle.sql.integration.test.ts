import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { validateMarkedLoopbackPostgres } from '../../../scripts/qc/loopback-postgres';

const boundary = vi.hoisted(() => ({ db: vi.fn(), pool: vi.fn(), supabase: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: boundary.db,
  getOrgTransactionDb: (db: unknown) => db,
}));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: boundary.pool }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: boundary.supabase }));
// Pulse's unchanged cancellation machinery has separate native suites. This
// fixture exercises actual lifecycle/recovery SQL; it makes no Pulse assertions.
vi.mock('./pulse-dispatch.store', () => ({ cancelPulseForOwnerTx: async () => undefined }));
vi.mock('$lib/plugins/icon-map', () => ({ PLUGIN_ICON_MAP: {} }));

import { deleteUser, updateUserOrganizations } from './user.service';
import { MODULES } from './rbac.service';

const schema = `role_lifecycle_${randomUUID().replaceAll('-', '')}`;
const org = randomUUID(),
  ownerProfile = randomUUID(),
  target = randomUUID(),
  operator = randomUUID();
const admin = 'custom-administrator',
  reader = 'custom-reader';
let owner: ReturnType<typeof postgres>, app: ReturnType<typeof postgres>;
let core: ReturnType<typeof drizzle>;
const ctx = { tenantId: org, db: {} } as unknown as Parameters<typeof deleteUser>[0];
const state: {
  deletes: number;
  authDelete: ReturnType<typeof vi.fn>;
  authGate?: () => Promise<void>;
  onOrgLock?: () => void;
  authError: Error | null;
} = { deletes: 0, authDelete: vi.fn(), authError: null };

interface LifecycleTransport {
  select(columns: string): LifecycleTransport;
  delete(): LifecycleTransport;
  eq(column: string, value: string): LifecycleTransport;
  in(column: string, values: string[]): LifecycleTransport;
  then(
    resolve: (value: { data: unknown; error: null }) => unknown,
    reject: (error: unknown) => unknown,
  ): Promise<unknown>;
}

/** PostgREST-shaped transport backed by real PostgreSQL, never an in-memory grant model. */
function transport(table: string) {
  if (table !== 'organization_members')
    throw new Error(`Unexpected lifecycle transport table: ${table}`);
  let mode: 'select' | 'delete' = 'select',
    profileId: string | undefined,
    orgIds: string[] | undefined;
  const chain: LifecycleTransport = {
    select: (_columns: string) => {
      mode = 'select';
      return chain;
    },
    delete: () => {
      mode = 'delete';
      return chain;
    },
    eq: (column: string, value: string) => {
      if (column !== 'profile_id') throw new Error('Unexpected transport filter');
      profileId = value;
      return chain;
    },
    in: (column: string, values: string[]) => {
      if (column !== 'organization_id') throw new Error('Unexpected transport scope');
      orgIds = values;
      return chain;
    },
    then: (
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject: (error: unknown) => unknown,
    ) => {
      const run = async (): Promise<{ data: unknown; error: null }> => {
        if (!profileId) throw new Error('Unscoped lifecycle transport');
        if (mode === 'select')
          return {
            data: await app`select organization_id from organization_members where profile_id=${profileId}::uuid`,
            error: null,
          };
        state.deletes++;
        if (orgIds)
          await app`delete from organization_members where profile_id=${profileId}::uuid and organization_id in ${app(orgIds)}`;
        else await app`delete from organization_members where profile_id=${profileId}::uuid`;
        return { data: null, error: null };
      };
      return run().then(resolve, reject);
    },
  };
  return chain;
}
beforeAll(async () => {
  const url = validateMarkedLoopbackPostgres(
    process.env.HUB_TEST_DB_URL,
    process.env.REQUIRE_ORG_ROLES_POSTGRES,
    'REQUIRE_ORG_ROLES_POSTGRES',
  );
  owner = postgres(url.href, { max: 1, prepare: false });
  app = postgres(url.href, {
    max: 6,
    prepare: false,
    connection: { search_path: `${schema},pg_catalog` },
  });
  await owner`create schema ${owner(schema)}`;
  core = drizzle(app, {
    logger: {
      logQuery(query) {
        if (query.includes('hashtextextended') && query.includes(',112')) state.onOrgLock?.();
      },
    },
  });
  boundary.db.mockReturnValue(core);
  boundary.pool.mockReturnValue(app);
  boundary.supabase.mockReturnValue({
    from: transport,
    auth: { admin: { deleteUser: state.authDelete } },
  });
  await app.unsafe(`
    create table organizations(id uuid primary key,name text,status text,role_model text,default_role_key text);
    create table profiles(id uuid primary key,role text,deletion_pending boolean not null default false);
    create table organization_members(organization_id uuid,profile_id uuid,role text,primary key(organization_id,profile_id));
    create table member_roles(org_id uuid,profile_id uuid,role_key text,granted_by uuid,primary key(org_id,profile_id,role_key));
    create table org_roles(org_id text,key text,name text,rank int,source_role_key text,primary key(org_id,key));
    create table permission_rules(org_id uuid,role_key text,module text,can_view boolean,can_create boolean,can_edit boolean,can_delete boolean,can_export boolean,can_manage boolean,if_owner boolean,field_level int);
    create table app_nav_config(org_id text primary key,value jsonb);
    create table doc_audit_log(id uuid primary key default gen_random_uuid(),org_id text,ref_type text,
      ref_id uuid,actor_id uuid,op text,changes jsonb);
  `);
  await import('./section-access.service');
  await import('./organization-role-admin.service');
}, 120_000);
beforeEach(async () => {
  state.deletes = 0;
  state.onOrgLock = undefined;
  state.authGate = undefined;
  state.authError = null;
  state.authDelete.mockReset().mockImplementation(async () => {
    await state.authGate?.();
    return { error: state.authError };
  });
  await app.unsafe(
    'truncate organizations,profiles,organization_members,member_roles,org_roles,permission_rules,app_nav_config,doc_audit_log',
  );
  await app`insert into organizations values(${org},'Lifecycle org','active','organization',${admin})`;
  await app`insert into profiles(id,role) values(${ownerProfile},'user'),(${target},'user'),(${operator},'admin')`;
  await app`insert into organization_members values(${org},${ownerProfile},'owner'),(${org},${target},'member')`;
  await app`insert into member_roles values(${org},${ownerProfile},${admin},${operator}),(${org},${target},${admin},${operator})`;
  await app`insert into org_roles values(${org},${admin},'Administrator',80,'admin'),(${org},${reader},'Reader',10,'viewer')`;
  for (const key of [admin, reader])
    for (const module of MODULES) {
      const full = key === admin;
      await app`insert into permission_rules values(${org},${key},${module},${full || module === 'crm'},${full},${full},${full},${full},${full},false,1)`;
    }
});
afterAll(async () => {
  if (app) await app.end();
  if (owner) {
    await owner`drop schema if exists ${owner(schema)} cascade`;
    await owner.end();
  }
});

describe('organization role lifecycle on PostgreSQL', () => {
  it('rolls back removal of the last access administrator while preserving a distinct owner', async () => {
    await app`update member_roles set role_key=${reader} where profile_id=${ownerProfile}`;
    await expect(updateUserOrganizations(ctx, target, [], operator)).rejects.toMatchObject({
      status: 409,
    });
    expect(await app`select role_key from member_roles where profile_id=${target}`).toEqual([
      expect.objectContaining({ role_key: admin }),
    ]);
    expect(
      await app`select role from organization_members where profile_id=${target}`,
    ).toHaveLength(1);
    expect(state.deletes).toBe(0);
    expect(await app`select * from doc_audit_log`).toHaveLength(0);
  });
  it('removes a member when another owner and administrator survive without a trailing broad delete', async () => {
    await updateUserOrganizations(ctx, target, [], operator);
    expect(await app`select * from organization_members where profile_id=${target}`).toHaveLength(
      0,
    );
    expect(await app`select * from member_roles where profile_id=${target}`).toHaveLength(0);
    expect(
      await app`select * from organization_members where profile_id=${ownerProfile}`,
    ).toHaveLength(1);
    expect(state.deletes).toBe(0);
    const [audit] = await app`select org_id,ref_id,actor_id,op,changes from doc_audit_log`;
    expect(audit).toMatchObject({
      org_id: org,
      ref_id: target,
      actor_id: operator,
      op: 'membership_remove',
      changes: [{ field: 'roles', old: [admin], new: [] }],
    });
  });
  it('audits the explicit default role when adding a new-model membership', async () => {
    await app`delete from member_roles where profile_id=${target}`;
    await app`delete from organization_members where profile_id=${target}`;
    await updateUserOrganizations(ctx, target, [org], operator);
    expect(await app`select role_key from member_roles where profile_id=${target}`).toEqual([
      expect.objectContaining({ role_key: admin }),
    ]);
    const [audit] = await app`select org_id,ref_id,actor_id,op,changes from doc_audit_log`;
    expect(audit).toMatchObject({
      org_id: org,
      ref_id: target,
      actor_id: operator,
      op: 'membership_add',
      changes: [{ field: 'roles', old: [], new: [admin] }],
    });
  });
  it('adds a legacy membership inside the profile-fenced native transaction', async () => {
    const legacy = randomUUID();
    await app`insert into organizations values(${legacy},'Legacy','active','legacy',null)`;
    await updateUserOrganizations(ctx, target, [org, legacy], operator);
    expect(
      await app`select role from organization_members where organization_id=${legacy} and profile_id=${target}`,
    ).toEqual([expect.objectContaining({ role: 'member' })]);
    expect(
      await app`select role_key from member_roles where org_id=${org} and profile_id=${target}`,
    ).toEqual([expect.objectContaining({ role_key: admin })]);
  });
  it('rolls back the deletion tombstone and membership when deleting the last owner is rejected', async () => {
    await app`update organization_members set role='member' where profile_id=${ownerProfile}`;
    await app`update organization_members set role='owner' where profile_id=${target}`;
    await expect(deleteUser(ctx, target, operator)).rejects.toMatchObject({ status: 409 });
    const [profile] = await app`select deletion_pending from profiles where id=${target}`;
    expect(profile.deletion_pending).toBe(false);
    expect(await app`select * from organization_members where profile_id=${target}`).toHaveLength(
      1,
    );
    expect(await app`select * from member_roles where profile_id=${target}`).toHaveLength(1);
    expect(state.authDelete).not.toHaveBeenCalled();
  });
  it('retains the admission fence when GoTrue deletion fails after membership removal', async () => {
    state.authError = new Error('Synthetic GoTrue failure');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(deleteUser(ctx, target, operator)).rejects.toThrow('Synthetic GoTrue failure');
      const [profile] = await app`select deletion_pending from profiles where id=${target}`;
      expect(profile.deletion_pending).toBe(true);
      expect(await app`select * from organization_members where profile_id=${target}`).toHaveLength(
        0,
      );
      await expect(updateUserOrganizations(ctx, target, [org], operator)).rejects.toThrow(
        'being deleted',
      );
    } finally {
      log.mockRestore();
    }
  });
  it('prevents re-admission during the gap between committed membership removal and GoTrue deletion', async () => {
    let entered!: () => void, release!: () => void;
    const hit = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    state.authGate = async () => {
      entered();
      await gate;
    };
    const deletion = deleteUser(ctx, target, operator);
    try {
      await hit;
      await expect(updateUserOrganizations(ctx, target, [org], operator)).rejects.toThrow(
        'being deleted',
      );
      expect(await app`select * from organization_members where profile_id=${target}`).toHaveLength(
        0,
      );
    } finally {
      release();
      await deletion;
    }
  });
  it('does not deadlock an organization policy reader against global account deletion', async () => {
    let policyReady!: () => void, readProfile!: () => void, orgAttempt!: () => void;
    const ready = new Promise<void>((resolve) => {
      policyReady = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      readProfile = resolve;
    });
    const attempted = new Promise<void>((resolve) => {
      orgAttempt = resolve;
    });
    const policy = app.begin(async (tx) => {
      await tx`set local lock_timeout='2s'`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${org},112))`;
      policyReady();
      await readGate;
      await tx`select id from profiles where id=${target}::uuid for share`;
    });
    await ready;
    state.onOrgLock = () => orgAttempt();
    const deletion = deleteUser(ctx, target, operator);
    try {
      await attempted;
      readProfile();
      await Promise.all([policy, deletion]);
    } finally {
      readProfile();
      state.onOrgLock = undefined;
    }
    expect(state.authDelete).toHaveBeenCalledWith(target);
  });
});
