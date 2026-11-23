import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateMarkedLoopbackPostgres } from '../../../scripts/qc/loopback-postgres';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
const fixture = vi.hoisted(() => ({ sql: null as unknown as ReturnType<typeof postgres> }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => fixture.sql }));
import * as rbac from './rbac.service';
import {
  saveOrganizationBranding,
  saveOrganizationMetadata,
  loadOrganizationBrandingSettings,
} from './organization-branding.service';
import { runWithEffectiveAuthority } from '$server/auth/effective-authority';
const url = testDatabaseUrl();
validateMarkedLoopbackPostgres(
  url,
  process.env.REQUIRE_QA_NATIVE_POSTGRES,
  'REQUIRE_QA_NATIVE_POSTGRES',
);
const label = `branding_${randomUUID().replaceAll('-', '')}`;
const sql = postgres(url!, { prepare: false, max: 10, connection: { application_name: label } });
fixture.sql = sql;
const users = Array.from({ length: 4 }, () => randomUUID());
const orgIds: string[] = [];
const barrier = randomUUID();
function locals(orgId: string, profileId = users[0]) {
  return {
    user: { id: profileId, supabaseId: profileId, role: 'user' },
    tenantCtx: { tenantId: orgId },
  } as App.Locals;
}
async function org(model = 'legacy') {
  const id = randomUUID();
  orgIds.push(id);
  await sql`insert into public.organizations(id,name,slug,role_model,default_role_key) values(${id}::uuid,'Faces',${label.replaceAll('_', '-') + '-' + orgIds.length},${model},${model === 'organization' ? 'custom-brand-admin' : null})`;
  await sql`insert into public.organization_members(organization_id,profile_id,role) values(${id}::uuid,${users[0]}::uuid,'owner'),(${id}::uuid,${users[1]}::uuid,'member'),(${id}::uuid,${users[2]}::uuid,'member')`;
  const key = model === 'legacy' ? 'owner' : 'custom-brand-admin';
  if (model !== 'legacy') {
    await sql`insert into public.org_roles(org_id,key,name,rank) values(${id},${key},'Brand Administrator',80)`;
    await sql`insert into public.permission_rules(org_id,role_key,module,can_view,can_manage) values(${id}::uuid,${key},'settings',true,true)`;
  }
  await sql`insert into public.member_roles(org_id,profile_id,role_key) values(${id}::uuid,${users[0]}::uuid,${key}),(${id}::uuid,${users[1]}::uuid,'staff')`;
  return id;
}
async function waitForLock(minimum = 1) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const [row] = await sql<
      { waiting: number }[]
    >`select count(*)::int as waiting from pg_stat_activity where application_name=${label} and wait_event_type='Lock'`;
    if (row.waiting >= minimum) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Expected actual PostgreSQL lock wait');
}
beforeAll(async () => {
  vi.spyOn(rbac, 'requireOrgCapability').mockResolvedValue(null);
  const [applied] =
    await sql`select version from public.hub_migrations where version='20261122000000'`;
  if (!applied) throw Error('Apply reviewed hub_name migration using the guarded runner first');
  for (const [index, id] of users.entries()) {
    await sql`insert into auth.users(id,email) values(${id}::uuid,${`${label}-${index}@fixture.test`})`;
    await sql`insert into public.profiles(id,email,role) values(${id}::uuid,${`${label}-${index}@fixture.test`},${index === 2 ? 'admin' : 'user'}) on conflict(id) do update set role=excluded.role`;
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await sql.unsafe(`drop trigger if exists "${label}" on public.organizations`);
  await sql.unsafe(`drop function if exists public."${label}"()`);
  for (const id of orgIds) {
    await sql`delete from public.permission_rules where org_id=${id}::uuid`;
    await sql`delete from public.member_roles where org_id=${id}::uuid`;
    await sql`delete from public.org_roles where org_id=${id}`;
    await sql`delete from public.organizations where id=${id}::uuid`;
  }
  await sql`delete from auth.users where id=any(${users}::uuid[])`;
  await sql.end();
});
describe('organization branding native PostgreSQL', () => {
  it('migration has no backfill and enforces nullable nonblank trimmed byte envelope', async () => {
    const id = await org();
    expect(await sql`select hub_name from public.organizations where id=${id}::uuid`).toMatchObject(
      [{ hub_name: null }],
    );
    const migration = await readFile(
      new URL(
        '../../../supabase/migrations/20261122000000_organization_hub_name.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const migrationSchema = `${label}_migration`;
    await sql.begin(async (tx) => {
      await tx.unsafe(`create schema "${migrationSchema}"`);
      await tx.unsafe(
        `create table "${migrationSchema}".organizations(id uuid primary key,name text)`,
      );
      await tx.unsafe(
        `insert into "${migrationSchema}".organizations values('${id}'::uuid,'Existing full name')`,
      );
      await tx.unsafe(migration.replaceAll('public.', `"${migrationSchema}".`));
      expect(
        await tx.unsafe(`select name,hub_name from "${migrationSchema}".organizations`),
      ).toMatchObject([{ name: 'Existing full name', hub_name: null }]);
      await tx.unsafe(`drop schema "${migrationSchema}" cascade`);
    });
    for (const value of ['', ' ', ' A', 'A ', 'x'.repeat(257)])
      await expect(
        sql`update public.organizations set hub_name=${value} where id=${id}::uuid`,
      ).rejects.toMatchObject({ code: '23514' });
    await sql`update public.organizations set hub_name=${'x'.repeat(256)} where id=${id}::uuid`;
    await sql`update public.organizations set hub_name=null where id=${id}::uuid`;
  });
  it('fresh owner membership permits both role models independently of the assigned role key', async () => {
    for (const model of ['legacy', 'organization']) {
      const id = await org(model);
      expect(await saveOrganizationBranding(locals(id), ' Clínica Faces ')).toMatchObject({
        hubName: 'Clínica Faces',
        branding: { orgId: id, source: 'custom', readStatus: 'ready' },
      });
      expect(await loadOrganizationBrandingSettings(locals(id))).toMatchObject({
        canEditBranding: true,
      });
      if (model === 'organization') {
        await sql`update public.permission_rules set can_manage=false where org_id=${id}::uuid and module='settings'`;
        await expect(saveOrganizationBranding(locals(id), 'Revoked')).rejects.toMatchObject({
          status: 403,
        });
        await sql`update public.permission_rules set can_manage=true,can_edit=false where org_id=${id}::uuid and module='settings'`;
      }
      await sql`update public.organization_members set role='member' where organization_id=${id}::uuid and profile_id=${users[0]}::uuid`;
      await expect(saveOrganizationMetadata(locals(id), { name: 'Bypass' })).rejects.toMatchObject({
        status: 403,
      });
      await sql`update public.organization_members set role='owner' where organization_id=${id}::uuid and profile_id=${users[0]}::uuid`;
      await saveOrganizationBranding(locals(id), null);
      await saveOrganizationMetadata(locals(id), { name: 'New Name' });
      expect((await loadOrganizationBrandingSettings(locals(id)))?.branding.name).toBe('New Name');
      await saveOrganizationBranding(locals(id), 'MINION');
      await saveOrganizationMetadata(locals(id), { name: 'Another' });
      expect((await loadOrganizationBrandingSettings(locals(id)))?.branding).toMatchObject({
        name: 'MINION',
        source: 'custom',
      });
    }
  });
  it('staff foreign profiles and deleting profiles cannot bypass either identity writer; simulation is read-only', async () => {
    const id = await org();
    for (const profile of [users[1], users[3]]) {
      await expect(saveOrganizationBranding(locals(id, profile), 'Stolen')).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        saveOrganizationMetadata(locals(id, profile), { name: 'Stolen' }),
      ).rejects.toMatchObject({ status: 403 });
    }
    const snapshot = {
      orgId: id,
      profileId: users[0],
      roleKey: 'owner',
      generation: 'fixture',
      rank: 100,
      invalid: false,
      capabilities: rbac.buildCapabilities(['owner'], []),
    };
    await expect(
      runWithEffectiveAuthority(snapshot, () => saveOrganizationBranding(locals(id), 'Blocked')),
    ).rejects.toMatchObject({ status: 403 });
    await sql`update public.profiles set deletion_pending=true where id=${users[3]}::uuid`;
    await expect(saveOrganizationBranding(locals(id, users[3]), 'Blocked')).rejects.toMatchObject({
      status: 403,
    });
    await sql`update public.profiles set deletion_pending=false where id=${users[3]}::uuid`;
    await saveOrganizationBranding(locals(id, users[2]), 'Platform');
    await sql`delete from public.organization_members where organization_id=${id}::uuid and profile_id=${users[2]}::uuid`;
    await expect(saveOrganizationBranding(locals(id, users[2]), 'Blocked')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('authenticated direct owner staff and foreign SQL cannot update the branding column', async () => {
    const id = await org();
    for (const profile of [users[0], users[1], users[3]]) {
      await sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub',${profile},true)`;
        expect(
          await tx`update public.organizations set hub_name='Bypass' where id=${id}::uuid returning id`,
        ).toHaveLength(0);
      });
    }
    expect(await sql`select hub_name from public.organizations where id=${id}::uuid`).toMatchObject(
      [{ hub_name: null }],
    );
  });
  it('unique slug rollback preserves both automatic source name and stored override', async () => {
    const id = await org(),
      duplicate = await org();
    const [row] = await sql`select slug from public.organizations where id=${duplicate}::uuid`;
    await saveOrganizationBranding(locals(id), 'Custom');
    await expect(
      saveOrganizationMetadata(locals(id), { name: 'Wrong', slug: row.slug }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await sql`select name,hub_name from public.organizations where id=${id}::uuid`,
    ).toMatchObject([{ name: 'Faces', hub_name: 'Custom' }]);
  });
  it('revocation committed before admission rejects the queued writer without changing identity', async () => {
    const id = await org();
    let release!: () => void, held!: () => void;
    const hold = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (held = r));
    const blocker = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${id},112))`;
      held();
      await hold;
      await tx`delete from public.organization_members where organization_id=${id}::uuid and profile_id=${users[0]}::uuid`;
    });
    await ready;
    const write = saveOrganizationBranding(locals(id), 'Too Late');
    const assertion = expect(write).rejects.toMatchObject({ status: 403 });
    await waitForLock();
    release();
    await blocker;
    await assertion;
    expect(await sql`select hub_name from public.organizations where id=${id}::uuid`).toMatchObject(
      [{ hub_name: null }],
    );
  });
  it('admitted writer holds membership locks through commit before a concurrent revocation', async () => {
    const id = await org();
    await sql.unsafe(
      `create function public."${label}"() returns trigger language plpgsql as $$ begin if new.id='${id}'::uuid then perform pg_advisory_xact_lock(hashtextextended('${barrier}',145)); end if; return new; end $$; create trigger "${label}" before update on public.organizations for each row execute function public."${label}"()`,
    );
    let release!: () => void, held!: () => void;
    const hold = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (held = r));
    const blocker = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${barrier},145))`;
      held();
      await hold;
    });
    await ready;
    const write = saveOrganizationBranding(locals(id), 'Committed');
    await waitForLock();
    let revoked = false;
    const revocation =
      sql`delete from public.organization_members where organization_id=${id}::uuid and profile_id=${users[0]}::uuid`.then(
        () => {
          revoked = true;
        },
      );
    await waitForLock(2);
    expect(revoked).toBe(false);
    release();
    await blocker;
    expect(await write).toMatchObject({ hubName: 'Committed' });
    await revocation;
    await expect(saveOrganizationBranding(locals(id), 'Blocked')).rejects.toMatchObject({
      status: 403,
    });
  });
});
