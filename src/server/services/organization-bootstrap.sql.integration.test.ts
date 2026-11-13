import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ARRAY_TYPES } from '$server/db/pg-pool';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { bootstrapOrganization, INITIAL_ADMINISTRATOR_KEY } from './organization-bootstrap.service';
import { MODULES } from './rbac.service';

const url = testDatabaseUrl();
if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Organization bootstrap requires explicit loopback HUB_TEST_DB_URL');
const schema = `qc_org_bootstrap_${randomUUID().replaceAll('-', '')}`;
const owner = postgres(url, { max: 1, prepare: false });
const app = postgres(url, {
  max: 4,
  prepare: false,
  fetch_types: false,
  types: ARRAY_TYPES as unknown as Record<string, postgres.PostgresType>,
  connection: { search_path: `${schema},pg_catalog` },
});
// Match the shared production pool after getCoreDb initializes Drizzle.
drizzle(app);
const creator = randomUUID();
const legacy = randomUUID();
beforeAll(async () => {
  await owner.unsafe(`create schema "${schema}"`);
  await app.unsafe(`
    create table profiles(id uuid primary key);
    create table organizations(id uuid primary key,name text,slug text unique,status text default 'active');
    create table org_roles(org_id text,key text,name text,rank int,source_role_key text,created_by text,primary key(org_id,key));
    create table permission_rules(org_id uuid,role_key text,module text,can_view bool,can_create bool,can_edit bool,can_delete bool,can_export bool,can_manage bool,if_owner bool,field_level int,unique(org_id,role_key,module));
    create table organization_members(organization_id uuid references organizations(id),profile_id uuid references profiles(id),role text,primary key(organization_id,profile_id));
    create table member_roles(org_id uuid references organizations(id),profile_id uuid references profiles(id),role_key text,granted_by uuid,primary key(org_id,profile_id,role_key));
    create table join_link(id uuid primary key);
    create table doc_audit_log(org_id text,ref_type text,ref_id uuid,actor_id uuid,op text,changes jsonb);
    create function reject_fixture_grant() returns trigger language plpgsql as $$begin
      if exists(select 1 from organizations where id=new.org_id and slug='invalid') then
        raise exception 'Injected fixture grant failure';
      end if;return new;end$$;
    create trigger reject_fixture_grant before insert on member_roles for each row execute function reject_fixture_grant();
  `);
  await app`insert into profiles values(${creator}::uuid)`;
  await app`insert into organizations(id,name,slug) values(${legacy}::uuid,'Legacy','legacy')`;
  await app`insert into permission_rules(org_id,role_key,module,can_view) values(${legacy}::uuid,'staff','crm',false)`;
  const migration = await readFile(
    new URL(
      '../../../supabase/migrations/20261112010000_organization_role_templates.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await app.unsafe(migration.replaceAll('public.', `"${schema}".`));
});
afterAll(async () => {
  await app.end();
  await owner.unsafe(`drop schema if exists "${schema}" cascade`);
  await owner.end();
});

describe('organization role bootstrap against PostgreSQL', () => {
  it('migration preserves legacy organizations and permission rows', async () => {
    expect(
      await app`select role_model,default_role_key from organizations where id=${legacy}::uuid`,
    ).toMatchObject([{ role_model: 'legacy', default_role_key: null }]);
    expect(
      await app`select role_key,module,can_view from permission_rules where org_id=${legacy}::uuid`,
    ).toMatchObject([{ role_key: 'staff', module: 'crm', can_view: false }]);
  });
  it('creates one Administrator with explicit full organization grants and separate ownership', async () => {
    const result = await bootstrapOrganization(
      { name: 'New org', slug: 'new-org', profileId: creator },
      app,
    );
    expect(result).toMatchObject({ created: true, roleModel: 'organization' });
    const [audit] =
      await app`select jsonb_typeof(changes) as kind,changes->0->>'field' as field,changes->0->>'defaultRole' as role from doc_audit_log where org_id=${result.id}`;
    expect(audit).toEqual({ kind: 'array', field: 'role_model', role: INITIAL_ADMINISTRATOR_KEY });
    const roles = await app`select key,name,rank from org_roles where org_id=${result.id}`;
    expect(roles).toMatchObject([
      { key: INITIAL_ADMINISTRATOR_KEY, name: 'Administrator', rank: 80 },
    ]);
    const rules = await app`select * from permission_rules where org_id=${result.id}::uuid`;
    expect(rules).toHaveLength(MODULES.length);
    expect(rules.every((r) => r.can_view)).toBe(true);
    expect(
      rules
        .filter((r) => r.module !== 'overview')
        .every((r) => r.can_create && r.can_edit && r.can_delete && r.can_export && r.can_manage),
    ).toBe(true);
    expect(
      await app`select role from organization_members where organization_id=${result.id}::uuid`,
    ).toMatchObject([{ role: 'owner' }]);
    expect(
      await app`select role_key from member_roles where org_id=${result.id}::uuid`,
    ).toMatchObject([{ role_key: INITIAL_ADMINISTRATOR_KEY }]);
  });
  it('rolls back organization, role and matrix when membership cannot commit', async () => {
    await expect(
      bootstrapOrganization({ name: 'Invalid creator', slug: 'invalid', profileId: creator }, app),
    ).rejects.toThrow();
    expect(await app`select id from organizations where slug='invalid'`).toHaveLength(0);
    expect(
      await app`select r.org_id from org_roles r left join organizations o on o.id::text=r.org_id where o.id is null`,
    ).toHaveLength(0);
  });
  it('serializes concurrent retries without duplicate roles or grants', async () => {
    const input = { name: 'Concurrent', slug: 'concurrent', profileId: creator };
    const results = await Promise.all([
      bootstrapOrganization(input, app),
      bootstrapOrganization(input, app),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await app`select * from org_roles where org_id=${results[0].id}`).toHaveLength(1);
    expect(await app`select * from member_roles where org_id=${results[0].id}::uuid`).toHaveLength(
      1,
    );
  });
  it('retry never restores Administrator after an explicit role replacement', async () => {
    const input = { name: 'Edited', slug: 'edited', profileId: creator };
    const result = await bootstrapOrganization(input, app);
    await app`update member_roles set role_key='custom-restricted' where org_id=${result.id}::uuid`;
    expect(await bootstrapOrganization(input, app)).toMatchObject({ created: false });
    expect(
      await app`select role_key from member_roles where org_id=${result.id}::uuid`,
    ).toMatchObject([{ role_key: 'custom-restricted' }]);
  });
  it('does not adopt or upgrade a legacy organization on a new-model retry', async () => {
    await app`insert into organization_members values(${legacy}::uuid,${creator}::uuid,'owner')`;
    expect(
      await bootstrapOrganization({ name: 'Legacy', slug: 'legacy', profileId: creator }, app),
    ).toMatchObject({ roleModel: 'legacy', created: false });
    expect(await app`select * from org_roles where org_id=${legacy}`).toHaveLength(0);
    expect(await app`select role_model from organizations where id=${legacy}::uuid`).toMatchObject([
      { role_model: 'legacy' },
    ]);
  });
  it('rejects adopting a slug owned by another member without granting access', async () => {
    const other = randomUUID();
    await app`insert into profiles(id) values(${other}::uuid)`;
    await expect(
      bootstrapOrganization({ name: 'Other', slug: 'new-org', profileId: other }, app),
    ).rejects.toThrow('retried by its owner');
  });
});

describe('bootstrap profile and provenance boundaries', () => {
  it('rejects a pending-deletion creator before any organization is created', async () => {
    await app`update profiles set deletion_pending=true where id=${creator}::uuid`;
    try {
      await expect(
        bootstrapOrganization({ name: 'Unavailable', slug: 'deleting', profileId: creator }, app),
      ).rejects.toThrow('active creator');
      expect(await app`select id from organizations where slug='deleting'`).toHaveLength(0);
    } finally {
      await app`update profiles set deletion_pending=false where id=${creator}::uuid`;
    }
  });
  it('rejects either half of an incomplete template provenance pair', async () => {
    await expect(
      app`insert into org_roles(org_id,key,name,rank,template_id) values(${legacy},'half-template','Invalid',10,'admin')`,
    ).rejects.toThrow();
    await expect(
      app`insert into org_roles(org_id,key,name,rank,template_version) values(${legacy},'half-version','Invalid',10,1)`,
    ).rejects.toThrow();
  });
  it('does not hold an organization row while waiting for its policy lock on retry', async () => {
    const input = { name: 'Policy race', slug: 'policy-race', profileId: creator };
    const result = await bootstrapOrganization(input, app);
    let release!: () => void;
    let ready!: () => void;
    const admitted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = app.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${result.id},112))`;
      ready();
      await gate;
      await tx`select id from organizations where id=${result.id}::uuid for update`;
    });
    await admitted;
    const retry = bootstrapOrganization(input, app);
    // Observe the real lock wait before making the competing row-lock request.
    try {
      const until = Date.now() + 5000;
      while (true) {
        const [blocked] = await owner<
          { n: number }[]
        >`select count(*)::int as n from pg_stat_activity where wait_event_type='Lock' and query like '%pg_advisory_xact_lock%' and query like '%112%'`;
        if (blocked.n > 0) break;
        if (Date.now() > until) throw Error('Retry did not reach policy lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await writer;
    expect(await retry).toMatchObject({ id: result.id, created: false });
  });
});

describe('inactive provisioning target', () => {
  it('rejects an inactive existing organization without resetting access', async () => {
    const input = { name: 'Inactive', slug: 'inactive', profileId: creator };
    const result = await bootstrapOrganization(input, app);
    await app`update organizations set status='inactive' where id=${result.id}::uuid`;
    const before = await app`select * from member_roles where org_id=${result.id}::uuid`;
    await expect(bootstrapOrganization(input, app)).rejects.toThrow('Active organization');
    expect(await app`select * from member_roles where org_id=${result.id}::uuid`).toEqual(before);
  });
});
