import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import type { CoreTx } from '$server/db/with-org-core';
const boundary = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: boundary.db }));
import {
  readSectionAccess,
  writeSectionAccess,
  deleteRoleAccessCatalog,
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
    create table "${schema}".organizations(id uuid primary key,name text,status text);
    create table "${schema}".profiles(id uuid primary key,role text);
    create table "${schema}".organization_members(organization_id uuid,profile_id uuid,role text);
    create table "${schema}".member_roles(org_id uuid,profile_id uuid,role_key text);
    create table "${schema}".permission_roles(key text primary key,name text,rank integer,description text,is_system boolean);
    create table "${schema}".org_roles(org_id uuid,key text,name text,rank integer,source_role_key text);
    create table "${schema}".permission_rules(org_id uuid,role_key text,module text,can_view boolean,can_create boolean,can_edit boolean,
      can_delete boolean,can_export boolean,can_manage boolean,if_owner boolean default false,field_level integer default 0,
      updated_at timestamptz default now(),unique(org_id,role_key,module));
    create table "${schema}".app_nav_config(org_id text primary key,value jsonb,updated_at timestamptz default now());
    grant usage on schema "${schema}" to app_ledger;
    grant select,insert,update,delete on "${schema}".app_nav_config to app_ledger;
    alter table "${schema}".app_nav_config enable row level security;
    alter table "${schema}".app_nav_config force row level security;
    create policy nav_org_scope on "${schema}".app_nav_config for all to app_ledger
      using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
    create table "${schema}".doc_audit_log(org_id text,ref_type text,ref_id uuid,actor_id uuid,actor_name text,op text,changes jsonb,
      simulation_role_key text,simulation_generation uuid);
  `);
  boundary.db.mockReturnValue(db);
});
beforeEach(async () => {
  await app`truncate organizations,profiles,organization_members,member_roles,permission_roles,org_roles,permission_rules,app_nav_config,doc_audit_log`;
  await app`insert into organizations values (${org},'Fixture org','active')`;
  await app`insert into profiles values (${profile},'user')`;
  await app`insert into organization_members values (${org},${profile},'owner')`;
  await app`insert into member_roles values (${org},${profile},'owner')`;
  await app`insert into permission_roles values ('owner','Owner',100,null,true),('viewer','Viewer',20,null,true)`;
  await app`insert into app_nav_config(org_id,value) values (${org},${JSON.stringify(nav)}::jsonb)`;
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
