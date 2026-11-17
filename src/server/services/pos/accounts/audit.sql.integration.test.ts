import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readOperatorAuthorityForWriteInTx,
  readOperatorAuthorityReadOnlyInTx,
} from '$server/auth/active-operator-principal';
import {
  ACTIONS,
  MODULES,
  composeFreshCapabilitiesFromAuthorityRows,
  resolveFreshCapabilitiesInTransaction,
} from '$server/services/rbac.service';
import { migrationSql, openAuditNativeChild, type AuditNativeChild } from './audit.native-setup';

/**
 * F7 native audit suite (minion-meta spec 128). Registered in NATIVE_POSTGRES_MANIFEST['qa-native']
 * with exactAssertions: the eight names below are the contract; do not add or rename.
 * Bodies that depend on later tasks throw TODO(handoff) until their owning task lands (lane red until T022).
 */
const ORG = randomUUID();
const ORG_CUSTOM = randomUUID();
const ORG_BIG = randomUUID();
const ORG_INACTIVE = randomUUID();
const ORG_FOREIGN = randomUUID();
const STAFF = randomUUID();
const CUSTOM = randomUUID();
const BIG = randomUUID();
const GONE = randomUUID(); // member of ORG, account deletion pending
const NONMEMBER = randomUUID();
const INACTIVE_USER = randomUUID();

let child: AuditNativeChild;
let owner: postgres.Sql;
let appClient: postgres.Sql;
let app: ReturnType<typeof drizzle>;
let fingerprintBefore: string;

const SIX =
  "('organizations','profiles','organization_members','member_roles','org_roles','permission_rules')";
const FINGERPRINT = `select coalesce(string_agg(c.relname || ':' || coalesce(c.relacl::text,'') || ':' || c.relrowsecurity || c.relforcerowsecurity, '|' order by c.relname), '') ||
  (select coalesce(string_agg(polname::text || polcmd::text || polroles::text || coalesce(pg_get_expr(polqual, polrelid),''), '|' order by polname), '')
     from pg_policy p join pg_class pc on pc.oid = p.polrelid where pc.relname in ${SIX}) as fp
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ${SIX}`;

async function fingerprint() {
  const [row] = await owner.unsafe(FINGERPRINT);
  return String(row.fp);
}

type Tx = Parameters<Parameters<typeof app.transaction>[0]>[0];
/** Run as app_ledger with the server's GUCs, in READ ONLY REPEATABLE READ ('ro') or default READ WRITE ('rw'). */
async function asApp<T>(
  orgId: string,
  profileId: string,
  mode: 'ro' | 'rw',
  fn: (tx: Tx) => Promise<T>,
  gucProfile: string = profileId,
): Promise<T> {
  return app.transaction(
    async (tx) => {
      await tx.execute(
        sql`select set_config('role','app_ledger',true), set_config('app.current_org_id',${orgId},true), set_config('app.current_profile_id',${gucProfile},true)`,
      );
      return fn(tx);
    },
    mode === 'ro' ? { isolationLevel: 'repeatable read', accessMode: 'read only' } : undefined,
  );
}

async function seed() {
  for (const [id, name] of [
    [ORG, 'audit-a'],
    [ORG_FOREIGN, 'audit-foreign'],
    [ORG_BIG, 'audit-big'],
    [ORG_INACTIVE, 'audit-inactive'],
  ])
    await owner.unsafe(`insert into public.organizations(id,name) values ('${id}','${name}')`);
  await owner.unsafe(
    `update public.organizations set status='suspended' where id='${ORG_INACTIVE}'`,
  );
  await owner.unsafe(
    `insert into public.organizations(id,name,role_model,default_role_key) values ('${ORG_CUSTOM}','audit-custom','organization','custom-reader')`,
  );
  for (const [id, email] of [
    [STAFF, 'staff'],
    [CUSTOM, 'custom'],
    [BIG, 'big'],
    [GONE, 'gone'],
    [NONMEMBER, 'nonmember'],
    [INACTIVE_USER, 'inactive'],
  ]) {
    await owner.unsafe(`insert into auth.users(id,email) values ('${id}','${email}@audit.test')`);
    await owner.unsafe(
      `insert into public.profiles(id,email) values ('${id}','${email}@audit.test')`,
    );
  }
  await owner.unsafe(`update public.profiles set deletion_pending=true where id='${GONE}'`);
  for (const [o, p] of [
    [ORG, STAFF],
    [ORG, GONE],
    [ORG_CUSTOM, CUSTOM],
    [ORG_BIG, BIG],
    [ORG_INACTIVE, INACTIVE_USER],
  ])
    await owner.unsafe(
      `insert into public.organization_members(organization_id,profile_id,role) values ('${o}','${p}','member')`,
    );
  await owner.unsafe(
    `insert into public.member_roles(org_id,profile_id,role_key) values ('${ORG}','${STAFF}','staff'),('${ORG_CUSTOM}','${CUSTOM}','custom-reader')`,
  );
  await owner.unsafe(
    `insert into public.org_roles(org_id,key,name,rank) values ('${ORG_CUSTOM}','custom-reader','Reader',10)`,
  );
  for (const [o, role, mod, view, manage] of [
    [ORG, 'staff', 'pos', true, false],
    [ORG, 'staff', 'finance', false, false],
    [ORG_CUSTOM, 'custom-reader', 'pos', true, true],
  ] as const)
    await owner.unsafe(
      `insert into public.permission_rules(org_id,role_key,module,can_view,can_manage,field_level) values ('${o}','${role}','${mod}',${view},${manage},1)`,
    );
  await owner.unsafe(
    `insert into public.member_roles(org_id,profile_id,role_key) select '${ORG_BIG}','${BIG}','r'||g from generate_series(1,129) g`,
  );
}

beforeAll(async () => {
  child = await openAuditNativeChild();
  owner = child.owner;
  appClient = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  app = drizzle(appClient);
  fingerprintBefore = await fingerprint();
  await owner.unsafe(migrationSql());
  await seed();
}, 180_000);

afterAll(async () => {
  await appClient?.end({ timeout: 5 });
  await child?.close();
});

const pending = (owner: string): never => {
  throw new Error(`TODO(handoff): ${owner} is not implemented yet`);
};

describe('faces receivables audit against PostgreSQL', () => {
  it('uses one read only snapshot and rejects mutations under app_ledger', async () => {
    // The migration changed no table ACL/RLS/policy.
    expect(await fingerprint()).toBe(fingerprintBefore);
    const [fn] =
      await owner.unsafe(`select pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig::text as config,
        has_function_privilege('app_ledger', p.oid, 'EXECUTE') as ledger,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
        has_function_privilege('app_assistant_ro', p.oid, 'EXECUTE') as assistant,
        (select count(*) from aclexplode(p.proacl) a where a.grantee = 0) as public_grants
      from pg_proc p where p.proname = 'minion_operator_authority_v1'`);
    expect(fn).toMatchObject({
      owner: 'minion_qc',
      prosecdef: true,
      ledger: true,
      anon: false,
      authenticated: false,
      service_role: false,
      assistant: false,
    });
    expect(Number(fn.public_grants)).toBe(0);
    expect(String(fn.config)).toContain('search_path=pg_catalog');
    // Unsafe table owner fails the migration preflight (and rolls back), never "fixes" ownership.
    await expect(
      owner.begin(async (tx) => {
        await tx.unsafe('alter table public.organizations owner to app_ledger');
        await tx.unsafe(migrationSql());
      }),
    ).rejects.toThrow(/untrusted table owner|common owner/);
    expect(await fingerprint()).toBe(fingerprintBefore);
    // Baseline negatives under the real app_ledger ACL: the bridge is the only way in.
    await asApp(ORG, STAFF, 'ro', async (tx) => {
      await expect(
        tx.transaction((t) => t.execute(sql`select 1 from public.organizations`)),
      ).rejects.toThrow();
    });
    await asApp(ORG, STAFF, 'rw', async (tx) => {
      await expect(
        tx.transaction((t) => t.execute(sql`select 1 from public.organization_members for share`)),
      ).rejects.toThrow();
    });
    // READ ONLY snapshot: the bridge works, a write in the same transaction is refused.
    await asApp(ORG, STAFF, 'ro', async (tx) => {
      const rows = await readOperatorAuthorityReadOnlyInTx(tx, ORG, STAFF);
      expect(rows).toMatchObject({
        orgId: ORG,
        profileId: STAFF,
        membershipRole: 'member',
        assignedRoleKeys: ['staff'],
      });
      expect([...new Set(rows.authorityRows.map((r) => r.table))].sort()).toEqual([
        'member_roles',
        'organization_members',
        'organizations',
        'permission_rules',
        'profiles',
      ]);
      await expect(
        tx.transaction((t) =>
          t.execute(
            sql`insert into public.member_roles(org_id,profile_id,role_key) values (${ORG},${STAFF},'x')`,
          ),
        ),
      ).rejects.toThrow();
    });
    // False mode requires READ ONLY REPEATABLE READ.
    await asApp(ORG, STAFF, 'rw', async (tx) => {
      await expect(readOperatorAuthorityReadOnlyInTx(tx, ORG, STAFF)).rejects.toMatchObject({
        code: 'operator_scope_invalid',
      });
    }).catch(() => undefined);
  });
  it('preserves canonical controls beyond 500 clients and exposes legacy residuals', () =>
    pending('T011-T013'));
  it('resolves explicit and provider invoice links without unsupported repair candidates', () =>
    pending('T017'));
  it('matches locking authority composition without locks or stale cache', async () => {
    const compare = (
      a: Awaited<ReturnType<typeof composeFreshCapabilitiesFromAuthorityRows>>,
      b: typeof a,
    ) => {
      expect(a.roles).toEqual(b.roles);
      expect(a.realRoles).toEqual(b.realRoles);
      expect(a.membershipRole).toBe(b.membershipRole);
      for (const m of MODULES) {
        for (const act of ACTIONS)
          expect(a.capabilities.can(m, act), `${m}:${act}`).toBe(b.capabilities.can(m, act));
        expect(a.capabilities.fieldLevel(m)).toBe(b.capabilities.fieldLevel(m));
      }
    };
    for (const [o, p] of [
      [ORG, STAFF],
      [ORG_CUSTOM, CUSTOM],
    ]) {
      // Reference: legacy locking adapter on the privileged fixture controller (app_ledger cannot run it).
      const ref = await drizzle(owner).transaction((tx) =>
        resolveFreshCapabilitiesInTransaction(tx, o, p),
      );
      const ro = await asApp(o, p, 'ro', async (tx) =>
        composeFreshCapabilitiesFromAuthorityRows(
          await readOperatorAuthorityReadOnlyInTx(tx, o, p),
          o,
          p,
        ),
      );
      const rw = await asApp(o, p, 'rw', async (tx) =>
        composeFreshCapabilitiesFromAuthorityRows(
          await readOperatorAuthorityForWriteInTx(tx, o, p),
          o,
          p,
        ),
      );
      compare(ref, ro);
      compare(ref, rw);
    }
    // False mode takes no advisory lock; true mode holds stock-v1 and org-authority locks until commit.
    const probe = postgres(child.url.href, { max: 1, prepare: false });
    const tryLocks = async () => {
      const [r] = await probe.unsafe(
        `select pg_try_advisory_lock(hashtextextended('minion:stock-write:v1:${ORG}',0)) as stock,
                pg_try_advisory_lock(hashtextextended('${ORG}',112)) as authority`,
      );
      await probe.unsafe('select pg_advisory_unlock_all()');
      return r as { stock: boolean; authority: boolean };
    };
    try {
      await asApp(ORG, STAFF, 'ro', async (tx) => {
        await readOperatorAuthorityReadOnlyInTx(tx, ORG, STAFF);
        expect(await tryLocks()).toEqual({ stock: true, authority: true });
      });
      await asApp(ORG, STAFF, 'rw', async (tx) => {
        await readOperatorAuthorityForWriteInTx(tx, ORG, STAFF);
        expect(await tryLocks()).toEqual({ stock: false, authority: false });
      });
      expect(await tryLocks()).toEqual({ stock: true, authority: true });
    } finally {
      await probe.end({ timeout: 5 });
    }
    // Fresh, not cached: a revoked rule is visible on the next call.
    await owner.unsafe(
      `update public.permission_rules set can_view=false where org_id='${ORG}' and role_key='staff' and module='pos'`,
    );
    const after = await asApp(ORG, STAFF, 'ro', async (tx) =>
      composeFreshCapabilitiesFromAuthorityRows(
        await readOperatorAuthorityReadOnlyInTx(tx, ORG, STAFF),
        ORG,
        STAFF,
      ),
    );
    expect(after.capabilities.can('pos', 'view')).toBe(false);
    await owner.unsafe(
      `update public.permission_rules set can_view=true where org_id='${ORG}' and role_key='staff' and module='pos'`,
    );
    // Refusals are typed; never an empty-authority fallback.
    const refuse = async (o: string, p: string, code: string, guc?: string) => {
      const error = await asApp(
        o,
        p,
        'ro',
        (tx) => readOperatorAuthorityReadOnlyInTx(tx, o, p),
        guc,
      ).then(
        () => null,
        (e) => e,
      );
      expect(error, code).toMatchObject({ code });
    };
    await refuse(ORG, STAFF, 'operator_scope_invalid', NONMEMBER);
    await refuse(ORG, NONMEMBER, 'operator_principal_inactive');
    await refuse(ORG, GONE, 'operator_principal_inactive');
    await refuse(ORG_INACTIVE, INACTIVE_USER, 'operator_principal_inactive');
    await refuse(ORG_FOREIGN, STAFF, 'operator_principal_inactive');
    await refuse(ORG_BIG, BIG, 'operator_authority_limit');
    await owner.unsafe(
      `delete from public.organization_members where organization_id='${ORG}' and profile_id='${STAFF}'`,
    );
    await refuse(ORG, STAFF, 'operator_principal_inactive');
  });
  it('isolates concurrent pages and foreign organization rows', () => pending('T013'));
  it('admits only approved matched evidence and preserves uncertainty', () => pending('T017/T018'));
  it('applies exact accounting timezone cohort and approved scope boundaries', () =>
    pending('T010/T013'));
  it('produces stable proposal hashes and UUIDs across fresh runs', () => pending('T020-T022'));
});
