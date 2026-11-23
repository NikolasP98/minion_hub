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
import {
  runWithEffectiveAuthority,
  runWithRequestCapabilities,
} from '$server/auth/effective-authority';
import { isHttpError } from '@sveltejs/kit';
import { PATCH as brandingPatch } from '../../routes/api/organizations/branding/+server';
import { PATCH as metadataPatch } from '../../routes/api/tenants/me/+server';
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
  it('PATCH handlers return committed branding and preserve identity through reset and rejected requests', async () => {
    const id = await org();
    const transcript: unknown[] = [];
    // Supply the request capability scope normally admitted by hooks, then run
    // the real preflight gate and the fresh locked database admission together.
    vi.mocked(rbac.requireOrgCapability).mockRestore();
    try {
      async function invoke(
        handler: typeof brandingPatch,
        path: string,
        body: unknown,
        profileId = users[0],
        raw = JSON.stringify(body),
      ) {
        const request = new Request(`http://localhost${path}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: raw,
        });
        let status: number;
        let output: unknown;
        let cacheControl: string | null = null;
        try {
          const response = await runWithRequestCapabilities(
            {
              orgId: id,
              profileId,
              capabilities: rbac.buildCapabilities(
                [profileId === users[0] ? 'owner' : 'staff'],
                [],
              ),
            },
            () => handler({ locals: locals(id, profileId), request } as never),
          );
          status = response.status;
          cacheControl = response.headers.get('cache-control');
          output = await response.json();
        } catch (cause) {
          if (!isHttpError(cause)) throw cause;
          status = cause.status;
          output = cause.body;
        }
        const [persisted] =
          await sql`select id,name,hub_name from public.organizations where id=${id}::uuid`;
        transcript.push({
          path,
          actor: profileId === users[0] ? 'owner' : 'staff',
          body,
          bytes: new TextEncoder().encode(raw).length,
          status,
          cacheControl,
          output,
          persisted,
        });
        return { status, cacheControl, output, persisted };
      }
      const brandingPath = '/api/organizations/branding';
      const metadataPath = '/api/tenants/me';
      expect(
        await invoke(brandingPatch, brandingPath, { hubName: '  Clínica Faces  ' }),
      ).toMatchObject({
        status: 200,
        cacheControl: 'private, no-store',
        output: {
          hubName: 'Clínica Faces',
          branding: {
            orgId: id,
            name: 'Clínica Faces',
            fullName: 'Clínica Faces Hub',
            source: 'custom',
            readStatus: 'ready',
          },
        },
        persisted: { id, name: 'Faces', hub_name: 'Clínica Faces' },
      });
      expect(
        await invoke(metadataPatch, metadataPath, { name: 'Faces International' }),
      ).toMatchObject({
        status: 200,
        output: { ok: true },
        persisted: { id, name: 'Faces International', hub_name: 'Clínica Faces' },
      });
      expect(await invoke(brandingPatch, brandingPath, { hubName: 'MINION' })).toMatchObject({
        status: 200,
        output: { branding: { name: 'MINION', source: 'custom' } },
      });
      expect(await invoke(metadataPatch, metadataPath, { name: 'New Faces' })).toMatchObject({
        status: 200,
        persisted: { name: 'New Faces', hub_name: 'MINION' },
      });
      expect(await invoke(brandingPatch, brandingPath, { hubName: null })).toMatchObject({
        status: 200,
        output: {
          hubName: null,
          branding: { name: 'New Faces', fullName: 'New Faces Hub', source: 'organization' },
        },
        persisted: { name: 'New Faces', hub_name: null },
      });
      for (const body of [
        { hubName: 'x'.repeat(16) },
        { hubName: 'Faces Hub' },
        { hubName: 'Faces', orgId: randomUUID() },
      ])
        expect(await invoke(brandingPatch, brandingPath, body)).toMatchObject({
          status: 400,
          persisted: { name: 'New Faces', hub_name: null },
        });
      const body = { hubName: 'Faces' };
      const padded = JSON.stringify(body).padEnd(2048, ' ');
      expect(await invoke(brandingPatch, brandingPath, body, users[0], padded)).toMatchObject({
        status: 200,
        persisted: { name: 'New Faces', hub_name: 'Faces' },
      });
      expect(await invoke(brandingPatch, brandingPath, body, users[0], padded + ' ')).toMatchObject(
        {
          status: 400,
          persisted: { name: 'New Faces', hub_name: 'Faces' },
        },
      );
      expect(
        await invoke(brandingPatch, brandingPath, { hubName: 'Stolen' }, users[1]),
      ).toMatchObject({ status: 403, persisted: { name: 'New Faces', hub_name: 'Faces' } });
      expect(await invoke(metadataPatch, metadataPath, { name: 'Stolen' }, users[1])).toMatchObject(
        { status: 403, persisted: { name: 'New Faces', hub_name: 'Faces' } },
      );
      if (process.env.PRINT_BRANDING_API_EVIDENCE === '1')
        console.info(
          JSON.stringify(
            {
              surface:
                'PATCH handlers + PostgreSQL; verified request identity supplied by fixture, no HTTP auth-hook exercise',
              transcript,
            },
            null,
            2,
          ),
        );
    } finally {
      vi.spyOn(rbac, 'requireOrgCapability').mockResolvedValue(null);
    }
  });
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
