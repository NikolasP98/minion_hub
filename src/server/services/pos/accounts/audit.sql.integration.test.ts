import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
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
import {
  buildLinkIntent,
  invoiceLinkBlocksProposal,
  loadAuditInvoiceLinks,
  runAuditInventory,
} from './audit';
import type { AuditScope, AuditSink, ResidualRecord, AuditSubject } from './audit.types';
import { admitEvidence, bookingEvidenceFacts, EvidenceInputError } from './audit.evidence';
import { buildProposal, classifyBooking } from './audit.logic';
import { createHash } from 'node:crypto';
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

type Tx = CoreTx;
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
      return fn(tx as unknown as CoreTx);
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

// ---- US1 inventory fixtures (synthetic, org F; org X proves foreign isolation) ----
const FORG = randomUUID();
const XORG = randomUUID();
const FPROFILE = randomUUID();
const N_CLIENTS = 520; // > the 500-row list cap
const MAY = '2026-05-10T15:00:00Z';
const JUNE = '2026-06-10T15:00:00Z';
const ids = {
  freeProduct: randomUUID(),
  cancelled: randomUUID(),
  paid: randomUUID(),
  identityless: randomUUID(),
  voided: randomUUID(),
  legacyVoided: randomUUID(),
  linked: randomUUID(),
  edgeIn: randomUUID(),
  edgeOut: randomUUID(),
};

async function seedFaces() {
  await owner.unsafe('set session_replication_role = replica');
  try {
    await owner.unsafe(
      `insert into public.organizations(id,name) values ('${FORG}','audit-faces') on conflict do nothing`,
    );
    await owner.unsafe(
      `insert into auth.users(id,email) values ('${FPROFILE}','owner@audit.test')`,
    );
    await owner.unsafe(
      `insert into public.profiles(id,email) values ('${FPROFILE}','owner@audit.test')`,
    );
    await owner.unsafe(
      `insert into public.organization_members(organization_id,profile_id,role) values ('${FORG}','${FPROFILE}','owner')`,
    );
    await owner.unsafe(
      `insert into public.fin_settings(org_id,timezone) values ('${FORG}','America/Lima'),('${XORG}','America/Lima')`,
    );
    await owner.unsafe(
      `insert into public.fin_products(id,org_id,code,name,unit_price,active) values ('${ids.freeProduct}','${FORG}','FREE','free',0,true)`,
    );
    // 520 clients, one unbilled booking each: 500 in May (local), 20 in June.
    await owner.unsafe(
      `insert into public.parties(id,org_id) select md5('p'||g)::uuid,'${FORG}' from generate_series(1,${N_CLIENTS}) g`,
    );
    await owner.unsafe(`insert into public.sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,party_id)
      select md5('b'||g)::uuid,'${FORG}','u'||g,gen_random_uuid(),gen_random_uuid(),
             case when g<=500 then timestamptz '${MAY}' else timestamptz '${JUNE}' end,
             case when g<=500 then timestamptz '${MAY}' else timestamptz '${JUNE}' end + interval '1 hour', md5('p'||g)::uuid
        from generate_series(1,${N_CLIENTS}) g`);
    // Excluded by the canonical unbilled predicate: cancelled, zero-priced product. Counted by neither.
    await owner.unsafe(`insert into public.sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,party_id,status)
      values ('${ids.cancelled}','${FORG}','ucx',gen_random_uuid(),gen_random_uuid(),'${MAY}','${MAY}',md5('p1')::uuid,'cancelled')`);
    // Local-midnight edges in America/Lima (UTC-5, no DST): 05:00Z is 00:00 on the 31st.
    await owner.unsafe(`insert into public.sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,party_id) values
      ('${ids.edgeIn}','${FORG}','uin',gen_random_uuid(),gen_random_uuid(),'2026-05-31T05:00:00Z','2026-05-31T06:00:00Z',md5('p2')::uuid),
      ('${ids.edgeOut}','${FORG}','uout',gen_random_uuid(),gen_random_uuid(),'2026-05-31T04:59:59Z','2026-05-31T06:00:00Z',md5('p3')::uuid)`);
    // Foreign org: must never appear.
    await owner.unsafe(
      `insert into public.parties(id,org_id) values ('${randomUUID()}','${XORG}')`,
    );
    await owner.unsafe(`insert into public.sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,party_id)
      values (gen_random_uuid(),'${XORG}','ux',gen_random_uuid(),gen_random_uuid(),'${MAY}','${MAY}',md5('p1')::uuid)`);
    // Paid unscheduled lines: normal, identityless, void, legacy voided; plus a linked line (outside U).
    const ticket = async (
      lineId: string,
      status: string,
      party: boolean,
      booking: string | null = null,
    ) => {
      const t = randomUUID();
      await owner.unsafe(`insert into public.pos_tickets(id,org_id,shift_id,status,subtotal,total,submitted_at,party_id)
        values ('${t}','${FORG}',gen_random_uuid(),'${status}',10,10,'${MAY}',${party ? "md5('p4')::uuid" : 'null'})`);
      await owner.unsafe(`insert into public.pos_ticket_lines(id,org_id,ticket_id,kind,description,qty,unit_price,total,booking_id)
        values ('${lineId}','${FORG}','${t}','service','svc',1,10,10,${booking ?? 'null'})`);
    };
    await ticket(ids.paid, 'submitted', true);
    await ticket(ids.identityless, 'submitted', false);
    await ticket(ids.voided, 'void', true);
    await ticket(ids.legacyVoided, 'voided', true);
    await ticket(ids.linked, 'submitted', true, "md5('b1')::uuid");
  } finally {
    await owner.unsafe('set session_replication_role = origin');
  }
}

class MemorySink implements AuditSink {
  subjects: AuditSubject[] = [];
  residuals: ResidualRecord[] = [];
  onFirstSubject?: () => Promise<void>;
  async writeSubject(s: AuditSubject) {
    this.subjects.push(s);
    if (this.subjects.length === 1) await this.onFirstSubject?.();
  }
  async writeResidual(r: ResidualRecord) {
    this.residuals.push(r);
  }
}
const scope = (over: Partial<AuditScope> = {}): AuditScope => ({
  orgId: FORG,
  accountingTimezone: 'America/Lima',
  approved: { after: null, before: null },
  cohort: { after: null, before: null },
  ...over,
});
const inventory = (sink: AuditSink, s: AuditScope = scope(), org = s.orgId) =>
  asApp(org, FPROFILE, 'ro', (tx) => runAuditInventory(tx, s, sink));

beforeAll(async () => {
  child = await openAuditNativeChild();
  owner = child.owner;
  appClient = postgres(child.url.href, { max: 1, prepare: false, onnotice: () => undefined });
  app = drizzle(appClient);
  fingerprintBefore = await fingerprint();
  await owner.unsafe(migrationSql());
  await seed();
  await seedFaces();
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
  it('preserves canonical controls beyond 500 clients and exposes legacy residuals', async () => {
    const sink = new MemorySink();
    const summary = await inventory(sink);
    // Independent reconciliation of the seed, not a re-run of the audit predicates.
    const unbilled = N_CLIENTS + 2 - 1; // 520 + two midnight-edge bookings; cancelled and the booking with a live ticket line excluded
    expect(summary.coverage).toBe('organization_all_date');
    expect(summary.controls.unbilledBookings.count).toBe(unbilled);
    expect(summary.controls.unbilledBookings.count).toBeGreaterThan(500);
    expect(summary.controls.badgePaidLines.count).toBe(2); // paid + identityless; void and legacy voided are excluded
    expect(summary.controls.listPendingLines.count).toBe(2); // paid + legacy voided (identity required)
    expect(summary.totals).toEqual({ badge: unbilled + 2, list: unbilled + 2 });
    // The readers differ by design: identityless is badge-only, legacy voided is list-only.
    expect(sink.residuals.map((r) => [r.control, r.reasonCode, r.id]).sort()).toEqual(
      [
        ['badge_not_list', 'identity_required', ids.identityless],
        ['list_not_badge', 'legacy_voided', ids.legacyVoided],
      ].sort(),
    );
    // Every subject in U is exported (all-date, cohort = U); the linked line and the foreign org are not subjects.
    expect(sink.subjects.some((x) => x.id === ids.linked)).toBe(false);
    expect(sink.subjects.filter((x) => x.kind === 'booking').length).toBe(N_CLIENTS + 3);
    expect(summary.controls.unbilledBookings.sampleIds).toHaveLength(100);
    expect(summary.controls.unbilledBookings.idsSha256).toMatch(/^[0-9a-f]{64}$/);
    // Identical inputs give identical hashes.
    const again = await inventory(new MemorySink());
    expect(again.controls).toEqual(summary.controls);
  });
  it('resolves explicit and provider invoice links without unsupported repair candidates', async () => {
    const uid = () => randomUUID();
    const I1 = uid(); // paid, nonshadowed
    const IVOID = uid();
    const booking = uid();
    const make = {
      explicitOnly: uid(), // invoice-linked, no POS line
      viaTicket: uid(), // reconciled ticket, no explicit id
      dupProvider: uid(),
      shadowOnly: uid(),
      foreignRef: uid(),
      broken: uid(),
      voidInvoice: uid(),
      bothPaths: uid(),
      plain: uid(),
    };
    await owner.unsafe('set session_replication_role = replica');
    try {
      const inv = (
        id: string,
        org: string,
        provider: string,
        ref: string,
        status: string,
        shadowed = false,
      ) =>
        owner.unsafe(
          `insert into public.fin_invoices(id,org_id,provider,provider_ref,status,shadowed) values ('${id}','${org}','${provider}','${ref}','${status}',${shadowed})`,
        );
      await inv(I1, FORG, 'susii', 'REF-1', 'paid');
      await inv(IVOID, FORG, 'susii', 'REF-V', 'void');
      await inv(uid(), FORG, 'susii', 'REF-2', 'paid');
      await inv(uid(), FORG, 'nubefact', 'REF-2', 'paid'); // same ref, second provider
      await inv(uid(), FORG, 'susii', 'REF-3', 'paid', true); // shadowed only
      await inv(uid(), XORG, 'susii', 'REF-4', 'paid'); // same ref, FOREIGN org
      const bk = (id: string, invoiceId: string | null) =>
        owner.unsafe(`insert into public.sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,party_id,invoice_id)
          values ('${id}','${FORG}','${id}',gen_random_uuid(),gen_random_uuid(),'${MAY}','${MAY}',md5('p9')::uuid,${invoiceId ? `'${invoiceId}'` : 'null'})`);
      const ticketFor = async (bookingId: string, ref: string) => {
        const t = uid();
        await owner.unsafe(`insert into public.pos_tickets(id,org_id,shift_id,status,subtotal,total,submitted_at,invoice_provider_ref)
          values ('${t}','${FORG}',gen_random_uuid(),'submitted',10,10,'${MAY}','${ref}')`);
        await owner.unsafe(`insert into public.pos_ticket_lines(id,org_id,ticket_id,kind,description,qty,unit_price,total,booking_id)
          values (gen_random_uuid(),'${FORG}','${t}','service','svc',1,10,10,'${bookingId}')`);
        return t;
      };
      await bk(make.explicitOnly, I1);
      await bk(make.viaTicket, null);
      await ticketFor(make.viaTicket, 'REF-1');
      await bk(make.dupProvider, null);
      await ticketFor(make.dupProvider, 'REF-2');
      await bk(make.shadowOnly, null);
      await ticketFor(make.shadowOnly, 'REF-3');
      await bk(make.foreignRef, null);
      await ticketFor(make.foreignRef, 'REF-4');
      await bk(make.broken, uid());
      await bk(make.voidInvoice, IVOID);
      await bk(make.bothPaths, I1);
      await ticketFor(make.bothPaths, 'REF-1');
      await bk(make.plain, null);
      void booking;
    } finally {
      await owner.unsafe('set session_replication_role = origin');
    }
    const links = await asApp(FORG, FPROFILE, 'ro', (tx) =>
      loadAuditInvoiceLinks(tx, FORG, Object.values(make), []),
    );
    const byId = new Map(links.bookings.map((b) => [b.bookingId, b]));
    const ticketOf = (b: (typeof links.bookings)[number]) =>
      links.tickets.find((t) => b.providerMatches.some((m) => m.ticketId === t.ticketId));
    // One entry per subject, even with explicit + ticket paths.
    expect(links.bookings).toHaveLength(Object.keys(make).length);
    const g = (k: keyof typeof make) => byId.get(make[k])!;
    expect(g('explicitOnly')).toMatchObject({
      explicitInvoiceId: I1,
      explicitResolved: true,
      ticketLineIds: [],
    });
    expect(g('viaTicket').explicitInvoiceId).toBeNull();
    expect(ticketOf(g('viaTicket'))?.state).toBe('one_nonshadowed');
    expect(ticketOf(g('dupProvider'))?.state).toBe('ambiguous');
    expect(ticketOf(g('dupProvider'))?.matches.map((m) => m.provider)).toEqual([
      'nubefact',
      'susii',
    ]);
    expect(ticketOf(g('shadowOnly'))?.state).toBe('ambiguous');
    expect(ticketOf(g('foreignRef'))?.state).toBe('unresolved'); // the foreign-org invoice is never matched
    expect(g('broken')).toMatchObject({ explicitResolved: false });
    expect(g('voidInvoice')).toMatchObject({ explicitInvoiceId: IVOID, explicitResolved: true }); // void stays linked evidence
    expect(g('bothPaths').providerMatches).toHaveLength(1);
    // Every linked/ambiguous/unresolved shape blocks a repair proposal; the plain booking does not.
    for (const key of Object.keys(make) as (keyof typeof make)[]) {
      expect(invoiceLinkBlocksProposal(g(key), ticketOf(g(key))), key).toBe(key !== 'plain');
    }
    // Badge/list controls are unchanged by evidence reads.
    const after = await inventory(new MemorySink());
    expect(after.controls.badgePaidLines.count).toBe(2);
    // Remove this behavior's rows so the other behaviors keep their independent counts.
    const list = Object.values(make)
      .map((id) => `'${id}'`)
      .join(',');
    await owner.unsafe(`delete from public.pos_ticket_lines where booking_id in (${list})`);
    await owner.unsafe(`delete from public.pos_tickets where invoice_provider_ref like 'REF-%'`);
    await owner.unsafe(`delete from public.sched_bookings where id in (${list})`);
    await owner.unsafe(`delete from public.fin_invoices where provider_ref like 'REF-%'`);
  });
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
        resolveFreshCapabilitiesInTransaction(tx as unknown as CoreTx, o, p),
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
      return r as unknown as { stock: boolean; authority: boolean };
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
  it('isolates concurrent pages and foreign organization rows', async () => {
    const sink = new MemorySink();
    // A second connection commits a new unbilled booking after the snapshot began, between subject writes.
    sink.onFirstSubject = async () => {
      await owner.unsafe('set session_replication_role = replica');
      await owner.unsafe(`insert into public.sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,party_id)
        values (gen_random_uuid(),'${FORG}','late',gen_random_uuid(),gen_random_uuid(),'${MAY}','${MAY}',md5('p5')::uuid)`);
      await owner.unsafe('set session_replication_role = origin');
    };
    const during = await inventory(sink);
    const after = await inventory(new MemorySink());
    expect(after.controls.unbilledBookings.count).toBe(during.controls.unbilledBookings.count + 1);
    expect(during.controls.unbilledBookings.idsSha256).not.toBe(
      after.controls.unbilledBookings.idsSha256,
    );
    // A foreign organization's rows are never visible: its scope cannot even prove a timezone.
    await expect(inventory(new MemorySink(), scope({ orgId: XORG }), FORG)).rejects.toMatchObject({
      code: 'accounting_timezone_mismatch',
    });
    // The subject set never contains the foreign booking.
    expect(
      sink.subjects.every((x) => x.clientKey === null || x.clientKey.startsWith('party:')),
    ).toBe(true);
    await owner.unsafe(`delete from public.sched_bookings where uid='late'`);
  });
  it('admits only approved matched evidence and preserves uncertainty', async () => {
    // Snapshot facts come from the real inventory; the actor's role comes from the real authority bridge.
    const sink = new MemorySink();
    await inventory(sink);
    const status = new Map(
      sink.subjects.filter((x) => x.kind === 'booking').map((x) => [x.id, x.status]),
    );
    const [{ id: target }] = await owner.unsafe(`select md5('b10')::uuid::text as id`);
    const targetId = String(target);
    expect(status.get(targetId)).toBe('accepted');
    const membership = (p: string) =>
      asApp(
        FORG,
        p,
        'ro',
        async (tx) => (await readOperatorAuthorityReadOnlyInTx(tx, FORG, p)).membershipRole,
      ).catch(() => null);
    expect(await membership(FPROFILE)).toBe('owner');
    const RUN = new Date().toISOString();
    const DOC = randomUUID();
    const PRODUCT = randomUUID();
    const mk = (kind: string, values: Record<string, unknown>, subject = targetId) => ({
      assertionId: randomUUID(),
      subject: { kind: 'booking', id: subject },
      kind,
      values,
      documentIds: [DOC],
      verifiedByProfileId: FPROFILE,
      verifiedAt: '2026-11-16T00:00:00.000Z',
    });
    const admit = (
      assertions: ReturnType<typeof mk>[],
      role: string | null,
      approved = assertions.map((a) => a.assertionId),
    ) => {
      const manifest = {
        schemaVersion: 1,
        orgId: FORG,
        approvalRef: 'ap',
        documents: [{ documentId: DOC, sha256: 'a'.repeat(64), privateRef: 'vault/1' }],
        assertions,
      };
      const bytes = JSON.stringify(manifest);
      return admitEvidence(
        manifest,
        bytes,
        {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          approvedAssertionIds: approved,
        },
        {
          orgId: FORG,
          approvalRef: 'ap',
          actorProfileId: FPROFILE,
          membershipRole: role,
          runStart: RUN,
          bookingStatus: (id) => status.get(id) ?? null,
          lineKnown: (id) => sink.subjects.some((x) => x.id === id),
        },
      );
    };
    const delivery = mk('service_delivery', {
      bookingMemberId: targetId,
      productId: PRODUCT,
      quantity: '1',
      deliveredAt: '2026-05-10T15:00:00.000Z',
    });
    const charge = mk('historical_charge', {
      bookingMemberId: targetId,
      productId: PRODUCT,
      quantity: '1',
      amount: '100.00',
      currency: 'PEN',
      agreedAt: '2026-05-01T00:00:00.000Z',
    });
    const unused = mk('unused_reservation', {
      bookingMemberId: targetId,
      used: false,
      asOf: '2026-11-01T00:00:00.000Z',
    });
    const global = {
      sourceCorrupt: false,
      identity: 'ok' as const,
      finiteScope: false,
      proposalEligible: false,
      proposalBlockers: [],
    };
    const classify = (admitted: ReturnType<typeof admit> | null, closure: 'A' | 'none') => {
      const e = admitted
        ? bookingEvidenceFacts(admitted, targetId, 'accepted')
        : {
            delivery: false,
            validUnused: false,
            validStale: false,
            staleNoChange: false,
            historicalCharge: false,
            evidenceConflict: false,
          };
      return classifyBooking({
        ...global,
        status: 'accepted',
        currentCatalogFree: false,
        currentPriceKnown: true,
        ...e,
        closure: { shape: closure, blockers: [] },
      });
    };
    // Only the owner (actual membership role) can bring evidence; a capable non-owner is refused before admission.
    expect(await membership(CUSTOM)).toBeNull();
    expect(() => admit([delivery], 'admin')).toThrow(EvidenceInputError);
    // Approved matched evidence admits and supports a debt candidate (the zero-settlement closure shape A is supplied here).
    expect(classify(admit([delivery, charge], 'owner'), 'A')).toMatchObject({
      primaryClassification: 'genuine-debt candidate',
      recommendedNextAction: 'normal_collection_review',
    });
    // Without evidence uncertainty is preserved: nothing is inferred from the current catalog or the date.
    expect(classify(null, 'none')).toMatchObject({
      primaryClassification: 'unresolved',
      uncertainty: expect.arrayContaining([
        'historical_charge_unverified',
        'service_delivery_unverified',
      ]),
    });
    // Contradiction (delivery + unused) stays unresolved and is never resolved by recency.
    expect(classify(admit([delivery, unused], 'owner'), 'none')).toMatchObject({
      primaryClassification: 'unresolved',
      reasonCodes: ['external_evidence_conflict'],
    });
    // An unapproved assertion is not admitted; a subject outside the audited snapshot is refused.
    expect(admit([delivery, charge], 'owner', [delivery.assertionId]).assertions).toHaveLength(1);
    const foreignBooking = (
      await owner.unsafe(
        `select id::text from public.sched_bookings where org_id='${XORG}' limit 1`,
      )
    )[0].id as string;
    expect(() =>
      admit(
        [
          mk(
            'service_delivery',
            { ...delivery.values, bookingMemberId: foreignBooking },
            foreignBooking,
          ),
        ],
        'owner',
      ),
    ).toThrow(/subject_not_in_scope/);
  });
  it('applies exact accounting timezone cohort and approved scope boundaries', async () => {
    // [2026-05-31, 2026-06-01): 05:00:00Z is local midnight (inside), 04:59:59Z is the previous local day (outside).
    const sink = new MemorySink();
    const day = await inventory(
      sink,
      scope({ approved: { after: '2026-05-31', before: '2026-06-01' } }),
    );
    expect(day.coverage).toBe('approved_scope');
    expect(sink.subjects.filter((x) => x.kind === 'booking').map((x) => x.id)).toEqual([
      ids.edgeIn,
    ]);
    expect(day.controls.unbilledBookings.count).toBe(1);
    // Narrow cohort inside U: the complement is counted but never exported.
    const narrow = new MemorySink();
    const split = await inventory(
      narrow,
      scope({
        approved: { after: '2026-05-01', before: '2026-07-01' },
        cohort: { after: '2026-06-01', before: '2026-07-01' },
      }),
    );
    expect(split.controls.unbilledBookings.cohortCount).toBe(N_CLIENTS - 500);
    expect(split.controls.unbilledBookings.complementCount).toBe(500 + 2 - 1);
    expect(split.controls.unbilledBookings.count).toBe(N_CLIENTS + 2 - 1);
    expect(narrow.subjects.every((x) => x.inCohort)).toBe(true);
    // Refusals before any inventory: widening, timezone mismatch, equal and impossible dates.
    const approved = { after: '2026-05-01', before: '2026-06-01' };
    for (const bad of [
      scope({ approved, cohort: { after: '2026-04-30', before: '2026-05-10' } }),
      scope({ approved, accountingTimezone: 'America/Bogota' }),
      scope({ approved: { after: '2026-05-01', before: '2026-05-01' } }),
      scope({ approved: { after: '2026-02-30', before: null } }),
    ]) {
      await expect(inventory(new MemorySink(), bad)).rejects.toMatchObject({
        name: 'AuditAdmissionError',
      });
    }
  });
  it('produces stable proposal hashes and UUIDs across fresh runs', async () => {
    // The paid line of client p4 plus a new unbilled booking of the same client form one exact pair.
    const booking = randomUUID();
    await owner.unsafe('set session_replication_role = replica');
    await owner.unsafe(`insert into public.sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,party_id)
      values ('${booking}','${FORG}','pair',gen_random_uuid(),gen_random_uuid(),'${MAY}','${MAY}',md5('p4')::uuid)`);
    await owner.unsafe('set session_replication_role = origin');
    const evidence = {
      assertionIds: [randomUUID()],
      documentHashes: ['a'.repeat(64)],
      assertionsHash: 'b'.repeat(64),
    };
    const build = (b = booking) =>
      asApp(FORG, FPROFILE, 'ro', (tx) =>
        buildLinkIntent(tx, {
          orgId: FORG,
          sourceGitSha: 'c'.repeat(40),
          ticketLineId: ids.paid,
          bookingMemberId: b,
          evidence,
        }),
      );
    try {
      const first = buildProposal(
        await build(),
        { runId: randomUUID(), observedAt: '2026-11-17T00:00:00.000Z' },
        ['/private/a.json'],
      );
      const second = buildProposal(
        await build(),
        { runId: randomUUID(), observedAt: '2026-12-31T00:00:00.000Z' },
        ['/elsewhere/b.json'],
      );
      // Fresh runs, fresh snapshots, different run metadata and relocated private evidence: same identity.
      expect(second.proposalHash).toBe(first.proposalHash);
      expect(second.proposalId).toBe(first.proposalId);
      expect(JSON.stringify(second.intent)).toBe(JSON.stringify(first.intent));
      expect(first.status).toBe('pending_owner_approval');
      // Exact effects of the counterfactual: only the paid-unscheduled and unbilled contributions move; wallet and money do not.
      expect(first.intent.effects).toMatchObject({
        paidUnscheduledDelta: -1,
        unbilledBookingDelta: -1,
        paymentMinorDelta: '0',
        stockQuantityDelta: '0',
      });
      expect(first.intent.effects.accountDisplay.before.pendingScheduling).toBe(2); // paid + legacy-voided line of client p4;
      expect(first.intent.effects.accountDisplay.after.pendingScheduling).toBe(1);
      expect(first.intent.effects.wallet.before).toEqual(first.intent.effects.wallet.after);
      expect(first.intent.change).toEqual({
        field: 'pos_ticket_lines.booking_id',
        from: null,
        to: booking,
      });
      // A changed business fact changes the approval identity.
      await owner.unsafe(
        `update public.sched_bookings set status='pending', updated_at = now() + interval '1 minute' where id='${booking}'`,
      );
      const changed = buildProposal(await build(), {
        runId: randomUUID(),
        observedAt: '2026-11-17T00:00:00.000Z',
      });
      expect(changed.proposalHash).not.toBe(first.proposalHash);
      expect(changed.proposalId).not.toBe(first.proposalId);
      // An already-linked line is not an eligible pair.
      await expect(
        asApp(FORG, FPROFILE, 'ro', (tx) =>
          buildLinkIntent(tx, {
            orgId: FORG,
            sourceGitSha: 'c'.repeat(40),
            ticketLineId: ids.linked,
            bookingMemberId: booking,
            evidence,
          }),
        ),
      ).rejects.toMatchObject({ name: 'AuditIncompleteError' });
    } finally {
      await owner.unsafe(`delete from public.sched_bookings where id='${booking}'`);
    }
  });
});
