import postgres from 'postgres';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

const databaseUrl = testDatabaseUrl();

if (process.env.REQUIRE_CRM_CONTACTS_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_CRM_CONTACTS_POSTGRES is set but SUPABASE_DB_URL is empty — the dedicated ' +
      'CRM contacts PostgreSQL job must provide it.',
  );
}

const dialect = new PgDialect();
const client = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 })
  : null;
const schema = `crm_page_${process.pid}_${Math.random().toString(36).slice(2)}`;

// A real Drizzle handle over the SAME connection the raw-SQL path uses, so the
// `tx` handed to services is query-capable on BOTH surfaces: `execute` for the
// hand-written ranking/finance SQL and `select` for the settings reads
// (`readCrmSettingsValue`). A tx that only implements `execute` makes
// `resolveDepositRule` throw and silently fall back to DEFAULT_DEPOSIT_RULE —
// the configured-rule assertions below would then pass on the default and prove
// nothing about reading `crm_settings` at all.
const orm = client ? drizzle(client) : null;
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_scope: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const query = dialect.sqlToQuery(statement);
        return client!.unsafe(query.sql, query.params as never[]);
      },
      select: (...args: Parameters<NonNullable<typeof orm>['select']>) => orm!.select(...args),
    }),
}));
// The finance bridge (and with it the revenue column `sort:'revenue'` orders by)
// is only built when BOTH modules are on, so the flag has to be switchable here.
let financeOn = false;
vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: async () => financeOn,
}));

import { getCrmDashboardStats, rankContactsPage } from './crm-contacts.service';
import { contactFinanceMap, contactFinanceSummary, rankCustomers } from './crm-finance.service';

const ids = {
  ana1: '00000000-0000-4000-8000-000000000001',
  ana2: '00000000-0000-4000-8000-000000000002',
  bea: '00000000-0000-4000-8000-000000000003',
  phone: '00000000-0000-4000-8000-000000000004',
  dni: '00000000-0000-4000-8000-000000000005',
  unscored: '00000000-0000-4000-8000-000000000006',
};
const ctx = { db: {} as never, tenantId: '00000000-0000-4000-8000-0000000000aa' };
const org = '00000000-0000-4000-8000-0000000000aa';
const party = '00000000-0000-4000-8000-0000000000bb';
const finClient = '00000000-0000-4000-8000-0000000000cc';
const invoice = '00000000-0000-4000-8000-0000000000dd';
// Second party/client/invoice: the "reservó pero no compró" fixture — one
// invoice whose only line is a booking deposit.
const depositParty = '00000000-0000-4000-8000-0000000000ee';
const depositClient = '00000000-0000-4000-8000-0000000000ef';
const depositInvoice = '00000000-0000-4000-8000-0000000000f0';

describe.runIf(Boolean(databaseUrl))('rankContactsPage against PostgreSQL', () => {
  beforeAll(async () => {
    await client!.unsafe(`create schema ${schema}`);
    await client!.unsafe(`set search_path to ${schema}, public`);
    await client!.unsafe(`
      create table crm_contacts (
        id uuid primary key, display_name text, owner_id uuid, source text,
        lifecycle_override text, custom_fields jsonb not null default '{}',
        party_id uuid, deleted_at timestamptz, org_id text,
        created_at timestamptz not null default now()
      );
      -- org_id is TEXT in production on every table below (pg-crm-schema,
      -- pg-finance-schema); typing it uuid here breaks any predicate that
      -- compares it to current_setting('app.current_org_id') instead of a
      -- bound parameter ("operator does not exist: uuid = text").
      create table crm_contact_identities (
        contact_id uuid, org_id text, channel text, external_id text, handle text
      );
      create table messages (
        org_id text, channel text, chat_id text, occurred_at timestamptz,
        created_at timestamptz, direction text, is_bot boolean
      );
      -- This fixture tests ranking semantics, not trigger maintenance. A live
      -- compatibility view supplies the same projection shape while the
      -- dedicated activity-rollup integration suite exercises the real table.
      create view crm_contact_activity_stats as
        select ci.contact_id, ci.org_id,
               count(*)::bigint as message_count,
               count(*) filter (where m.direction = 'inbound')::bigint as inbound_count,
               count(*) filter (where m.direction = 'outbound')::bigint as outbound_count,
               count(distinct m.channel)::int as channels_used,
               min(coalesce(m.occurred_at, m.created_at)) as first_contact_at,
               max(coalesce(m.occurred_at, m.created_at)) as last_contact_at,
               max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'inbound') as last_inbound_at,
               max(coalesce(m.occurred_at, m.created_at)) filter (where m.direction = 'outbound') as last_outbound_at
        from crm_contact_identities ci
        join messages m on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
        where m.is_bot is not true
        group by ci.contact_id, ci.org_id;
      create table parties (
        id uuid primary key, doc_number text, dni_verified boolean, dob date,
        metadata jsonb not null default '{}'
      );
      create table crm_contact_tags (contact_id uuid, tag_id uuid);
      create table meta_lead_attribution (
        org_id text, channel text, sender_id text, origin text,
        campaign_name text, first_contact_at timestamptz
      );
      create table fin_clients (id uuid primary key, org_id text, party_id uuid);
      -- document_id/status are selected by contactFinanceSummary's
      -- representative-invoice query; omitting them made that path unreachable
      -- from this fixture.
      create table fin_invoices (
        id uuid primary key, client_id uuid, issued_at timestamptz, total numeric,
        shadowed boolean not null default false,
        document_id text, status text
      );
      create table fin_invoice_items (invoice_id uuid, description text, total numeric);
      -- crm_settings.value.deposit backs resolveDepositRule (crm-settings.service.ts) —
      -- org_id is TEXT here too, same production-parity reasoning as every other table above.
      create table crm_settings (
        org_id text primary key, value jsonb not null default '{}', updated_at timestamptz not null default now()
      );
    `);
    await client!.unsafe(
      `insert into crm_contacts (id, display_name, custom_fields) values
       ($1, 'Ana', '{"_icp":{"score":90}}'),
       ($2, 'Ana', '{"_icp":{"score":90}}'),
       ($3, 'Bea', '{"_icp":{"score":70}}'),
       ($4, 'Phone', '{"telefono":"51987654321","_icp":{"score":60}}'),
       ($5, 'DNI', '{"dni":"44556677","_icp":{"score":50}}'),
       ($6, 'No score', '{}')`,
      [ids.ana1, ids.ana2, ids.bea, ids.phone, ids.dni, ids.unscored],
    );
    // Only "No score" carries a party, so it is the only contact the finance
    // bridge can attach revenue to — which makes it the expected head of
    // `sort:'revenue'` even though it sits LAST on every other axis.
    await client!.unsafe(`update crm_contacts set org_id = $1`, [org]);
    await client!.unsafe(`select set_config('app.current_org_id', $1, false)`, [org]);
    await client!.unsafe(`update crm_contacts set party_id = $1 where id = $2`, [
      party,
      ids.unscored,
    ]);
    await client!.unsafe(
      `insert into parties (id, doc_number, dni_verified) values ($1, '99887766', true)`,
      [party],
    );
    await client!.unsafe(`insert into fin_clients (id, org_id, party_id) values ($1, $2, $3)`, [
      finClient,
      org,
      party,
    ]);
    await client!.unsafe(
      `insert into fin_invoices (id, client_id, issued_at, total)
       values ($1, $2, now() - interval '10 days', 500)`,
      [invoice, finClient],
    );
    // TWO lines on one invoice, and the DEPOSIT line is the pricier of the two.
    // That is what makes the rule-dependent SELECTIONS observable: under the
    // default rule "Reserva de cita" is excluded, so the representative item and
    // the top product are both "Botox facial"; under a rule that does not name
    // "reserva" nothing is a deposit and the priciest line wins instead. The
    // invoice total (500) is unchanged by either, which is the arithmetic
    // invariant the rule must never move.
    await client!.unsafe(
      `insert into fin_invoice_items (invoice_id, description, total) values
       ($1, 'Reserva de cita', 400), ($1, 'Botox facial', 100)`,
      [invoice],
    );

    // Awaiting-reply fixture: Bea's last message is inbound (we owe her a
    // reply); Phone answered afterwards, so she is NOT awaiting.
    await client!.unsafe(
      `insert into crm_contact_identities (contact_id, org_id, channel, external_id) values
       ($1, $3, 'whatsapp', 'wa-bea'), ($2, $3, 'whatsapp', 'wa-phone')`,
      [ids.bea, ids.phone, org],
    );
    await client!.unsafe(
      `insert into messages (org_id, channel, chat_id, occurred_at, created_at, direction, is_bot) values
       ($1, 'whatsapp', 'wa-bea', now() - interval '2 days', now(), 'inbound', false),
       ($1, 'whatsapp', 'wa-phone', now() - interval '3 days', now(), 'inbound', false),
       ($1, 'whatsapp', 'wa-phone', now() - interval '1 day', now(), 'outbound', false)`,
      [org],
    );

    // Reserved-only fixture: DNI booked (deposit line) but never purchased.
    await client!.unsafe(`update crm_contacts set party_id = $1 where id = $2`, [
      depositParty,
      ids.dni,
    ]);
    await client!.unsafe(`insert into parties (id) values ($1)`, [depositParty]);
    await client!.unsafe(`insert into fin_clients (id, org_id, party_id) values ($1, $2, $3)`, [
      depositClient,
      org,
      depositParty,
    ]);
    await client!.unsafe(
      `insert into fin_invoices (id, client_id, issued_at, total)
       values ($1, $2, now() - interval '5 days', 50)`,
      [depositInvoice, depositClient],
    );
    await client!.unsafe(
      `insert into fin_invoice_items (invoice_id, description, total) values ($1, 'Reserva de cita', 50)`,
      [depositInvoice],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.unsafe(`drop schema if exists ${schema} cascade`);
    await client.end({ timeout: 5 });
  });

  it('keeps the independently counted total across populated and empty offsets', async () => {
    const [{ count }] = await client!.unsafe<{ count: number }[]>(
      'select count(*)::int as count from crm_contacts where deleted_at is null',
    );
    const first = await rankContactsPage({ db: {} as never, tenantId: org }, { limit: 2 });
    const empty = await rankContactsPage(
      { db: {} as never, tenantId: org },
      { limit: 2, offset: 100 },
    );
    expect(first.total).toBe(count);
    expect(first.rows).toHaveLength(2);
    expect(empty).toEqual({
      rows: [],
      total: count,
      hasMore: false,
      financeEnabled: false,
    });
  });

  it('sorts ICP null last and traverses tied rows exactly once', async () => {
    const seen: string[] = [];
    for (const offset of [0, 2, 4]) {
      const page = await rankContactsPage(
        { db: {} as never, tenantId: org },
        { sort: 'icp', limit: 2, offset },
      );
      seen.push(...page.rows.map((row) => row.contact_id));
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen.slice(0, 2)).toEqual([ids.ana1, ids.ana2]);
    expect(seen.at(-1)).toBe(ids.unscored);
  });

  it.each([
    ['5198', ids.phone],
    ['4455', ids.dni],
    // Party-spine DNI: "No score" has no custom_fields.dni, only party doc_number 99887766.
    ['9988', ids.unscored],
  ])('matches exact phone/DNI prefix %s', async (search, expectedId) => {
    const page = await rankContactsPage({ db: {} as never, tenantId: org }, { search, limit: 20 });
    expect(page.rows.map((row) => row.contact_id)).toEqual([expectedId]);
  });

  it("sort:'revenue' ranks by the finance bridge and never leaks the helper column", async () => {
    financeOn = true;
    try {
      const page = await rankContactsPage(
        { db: {} as never, tenantId: org },
        { sort: 'revenue', limit: 10 },
      );

      expect(page.total).toBe(6);
      expect(page.rows[0].contact_id).toBe(ids.unscored);
      expect(page.rows[0]).not.toHaveProperty('revenue');
      expect(page.rows[0]).not.toHaveProperty('total_rows');
      expect(page.rows[0]).not.toHaveProperty('page_position');
    } finally {
      financeOn = false;
    }
  });

  it.each(['5198', '9988'])(
    'a masked principal cannot probe the phone/DNI/doc_number digits the mask hides %s',
    async (search) => {
      const page = await rankContactsPage(
        { db: {} as never, tenantId: org },
        { search, limit: 20, maskSensitive: true },
      );
      expect(page).toEqual({ rows: [], total: 0, hasMore: false, financeEnabled: false });
    },
  );

  it.each(['8765', '5566', '8877'])('does not match phone/DNI mid-string %s', async (search) => {
    const page = await rankContactsPage({ db: {} as never, tenantId: org }, { search, limit: 20 });
    expect(page).toEqual({ rows: [], total: 0, hasMore: false, financeEnabled: false });
  });

  // ── Slice 2: filters the Customers page used to apply over the FULL roster ──
  // Each asserts SET equality against the client-side predicate it replaces,
  // evaluated over the whole fixture roster (order is the sort's business).
  const roster = () => rankContactsPage(ctx, { limit: 100 });
  const idsOf = (rows: { contact_id: string }[]) => new Set(rows.map((r) => r.contact_id));

  it('awaitingReply selects exactly the rows the client predicate kept', async () => {
    const all = await roster();
    const expected = all.rows.filter((r) => r.awaiting_reply);
    // non-vacuous: the roster must contain BOTH classes, or the filter is untested
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(all.rows.length);

    const page = await rankContactsPage(ctx, { awaitingReply: true, limit: 100 });
    expect(idsOf(page.rows)).toEqual(idsOf(expected));
    expect(page.total).toBe(expected.length);
  });

  it('aggregates the full dashboard in SQL with the same roster semantics', async () => {
    const all = await roster();
    const stats = await getCrmDashboardStats(ctx);
    const stageCounts = Object.fromEntries(
      ['New', 'Engaged', 'Active', 'Dormant', 'Churned'].map((stage) => [
        stage,
        all.rows.filter((row) => row.stage === stage).length,
      ]),
    );
    const scoreBuckets = new Array(10).fill(0) as number[];
    for (const row of all.rows) {
      scoreBuckets[Math.min(9, Math.max(0, Math.floor(row.score / 10)))]++;
    }

    expect(stats).toMatchObject({
      total: all.rows.length,
      avgScore: Math.round(all.rows.reduce((sum, row) => sum + row.score, 0) / all.rows.length),
      stageCounts,
      scoreBuckets,
      response: {
        inboundContacts: all.rows.filter((row) => row.inbound_msgs > 0).length,
        awaiting: all.rows.filter((row) => row.inbound_msgs > 0 && row.awaiting_reply).length,
      },
      revenue: null,
    });
    expect(stats.channels).toEqual([{ channel: 'whatsapp', count: 2 }]);
  });

  it('buyerOnly selects exactly the contacts with a purchase history', async () => {
    financeOn = true;
    try {
      const all = await roster();
      const expected = all.rows.filter((r) => r.is_buyer);
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.length).toBeLessThan(all.rows.length);

      const page = await rankContactsPage(ctx, { buyerOnly: true, limit: 100 });
      expect(idsOf(page.rows)).toEqual(idsOf(expected));
      expect(page.total).toBe(expected.length);
    } finally {
      financeOn = false;
    }
  });

  it("reservedOnly mirrors the list's reserved toggle (finance.reservedOnly), not is_buyer", async () => {
    financeOn = true;
    try {
      const all = await roster();
      const fin = await contactFinanceMap(ctx);
      // The shipped client predicate: `finOf(c)?.reservedOnly === true`.
      const expected = all.rows.filter((r) => fin[r.contact_id]?.reservedOnly === true);
      expect(expected.map((r) => r.contact_id)).toEqual([ids.dni]);

      const page = await rankContactsPage(ctx, { reservedOnly: true, limit: 100 });
      expect(idsOf(page.rows)).toEqual(idsOf(expected));
      expect(page.total).toBe(expected.length);
      // The distinction that matters: the invoice-carrying non-deposit buyer is
      // a buyer but NOT reserved-only.
      const buyers = await rankContactsPage(ctx, { buyerOnly: true, limit: 100 });
      expect(idsOf(buyers.rows).has(ids.unscored)).toBe(true);
      expect(idsOf(page.rows).has(ids.unscored)).toBe(false);
    } finally {
      financeOn = false;
    }
  });

  it('minIcp/maxIcp are inclusive at both endpoints and drop unscored rows', async () => {
    const all = await roster();
    const icpOf = (r: (typeof all.rows)[number]) => {
      const raw = (r.custom_fields?._icp as { score?: unknown } | undefined)?.score;
      return typeof raw === 'number' ? raw : null;
    };
    const inRange = (min: number, max: number) =>
      idsOf(all.rows.filter((r) => icpOf(r) != null && icpOf(r)! >= min && icpOf(r)! <= max));

    const page = await rankContactsPage(ctx, { minIcp: 60, maxIcp: 90, limit: 100 });
    expect(idsOf(page.rows)).toEqual(inRange(60, 90));
    expect(page.total).toBe(inRange(60, 90).size);
    // endpoints are IN the range: 60 (Phone) and 90 (both Anas) survive…
    expect(idsOf(page.rows)).toEqual(new Set([ids.ana1, ids.ana2, ids.bea, ids.phone]));
    // …and the row with no _icp is never swept in as a 0.
    expect(idsOf(page.rows).has(ids.unscored)).toBe(false);
    const unbounded = await rankContactsPage(ctx, { minIcp: 0, limit: 100 });
    expect(idsOf(unbounded.rows).has(ids.unscored)).toBe(false);
  });

  // ── Slice 1 (2026-08-20-handoff-minion-hub-2785164896-spec): the finance
  // service and contacts ranking path must resolve and observe the SAME
  // per-org deposit rule, immediately on a same-tenant rule change. ──
  it('a same-tenant rule change (default → custom → empty → back to absent) is visible immediately, with finance/contacts classification agreeing at every step', async () => {
    financeOn = true;
    // A silent fallback to DEFAULT_DEPOSIT_RULE would make every "custom rule"
    // assertion below pass on the default and prove nothing, so the fallback
    // path is asserted NOT to fire rather than merely assumed absent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Default (no crm_settings row yet): DNI's only invoice line is "Reserva
      // de cita" — matches the default 'reserva' keyword, so DNI is reserved-only.
      const finDefault = await contactFinanceMap(ctx);
      expect(finDefault[ids.dni]).toMatchObject({ purchased: false, reservedOnly: true });
      const pageDefaultReserved = await rankContactsPage(ctx, { reservedOnly: true, limit: 100 });
      expect(idsOf(pageDefaultReserved.rows).has(ids.dni)).toBe(true);

      // Custom rule that does NOT contain 'reserva': the same line item no
      // longer matches any keyword, so DNI becomes a real (non-deposit) buyer —
      // in BOTH the finance map and the contacts ranking path.
      await client!.unsafe(
        `insert into crm_settings (org_id, value) values ($1, $2::jsonb)
         on conflict (org_id) do update set value = excluded.value`,
        [org, JSON.stringify({ deposit: { keywords: ['adelanto'], label: 'Adelanto' } })],
      );
      const finCustom = await contactFinanceMap(ctx);
      expect(finCustom[ids.dni]).toMatchObject({ purchased: true, reservedOnly: false });
      const pageCustomReserved = await rankContactsPage(ctx, { reservedOnly: true, limit: 100 });
      expect(idsOf(pageCustomReserved.rows).has(ids.dni)).toBe(false);
      const pageCustomBuyer = await rankContactsPage(ctx, { buyerOnly: true, limit: 100 });
      expect(idsOf(pageCustomBuyer.rows).has(ids.dni)).toBe(true);

      // Explicitly empty keywords: nothing is ever a deposit, so any line item
      // makes the contact a purchaser — same conclusion, proven independently
      // (no dropped predicate silently widening the match instead).
      await client!.unsafe(`update crm_settings set value = $2::jsonb where org_id = $1`, [
        org,
        JSON.stringify({ deposit: { keywords: [], label: 'None' } }),
      ]);
      const finEmpty = await contactFinanceMap(ctx);
      expect(finEmpty[ids.dni]).toMatchObject({ purchased: true, reservedOnly: false });
      const pageEmptyReserved = await rankContactsPage(ctx, { reservedOnly: true, limit: 100 });
      expect(idsOf(pageEmptyReserved.rows).has(ids.dni)).toBe(false);
      const pageEmptyBuyer = await rankContactsPage(ctx, { buyerOnly: true, limit: 100 });
      expect(idsOf(pageEmptyBuyer.rows).has(ids.dni)).toBe(true);

      // Back to an absent deposit key: parity with the original default, and
      // rankContactsPage agrees with contactFinanceMap again too.
      await client!.unsafe(`update crm_settings set value = '{}'::jsonb where org_id = $1`, [org]);
      const finBack = await contactFinanceMap(ctx);
      expect(finBack[ids.dni]).toMatchObject({ purchased: false, reservedOnly: true });
      const pageBackReserved = await rankContactsPage(ctx, { reservedOnly: true, limit: 100 });
      expect(idsOf(pageBackReserved.rows).has(ids.dni)).toBe(true);

      // Invoice totals/counts never move across any of these rule changes —
      // only classification and item selection do.
      expect(finCustom[ids.dni].invoices).toBe(finDefault[ids.dni].invoices);
      expect(finCustom[ids.dni].revenue).toBe(finDefault[ids.dni].revenue);
      expect(finEmpty[ids.dni].invoices).toBe(finDefault[ids.dni].invoices);
      expect(finEmpty[ids.dni].revenue).toBe(finDefault[ids.dni].revenue);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      financeOn = false;
      warn.mockRestore();
      await client!.unsafe(`delete from crm_settings where org_id = $1`, [org]);
    }
  });

  // D1/D4: the two remaining public finance paths, on the SAME fixture, where
  // the rule moves an item SELECTION rather than a boolean flag.
  it('contactFinanceSummary and rankCustomers follow the configured rule: representative item and top product move, invoice arithmetic does not', async () => {
    financeOn = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setRule = (deposit: unknown) =>
      client!.unsafe(
        `insert into crm_settings (org_id, value) values ($1, $2::jsonb)
         on conflict (org_id) do update set value = excluded.value`,
        [org, JSON.stringify({ deposit })],
      );
    const topProductOf = async () =>
      (await rankCustomers(ctx, 'revenue', 5)).find((c) => c.contactId === ids.unscored);

    try {
      // Absent key ⇒ the S1 default: "Reserva de cita" is a deposit, so the
      // representative line and the top product are the CHEAPER "Botox facial".
      const summaryDefault = await contactFinanceSummary(ctx, ids.unscored);
      const rankedDefault = await topProductOf();
      expect(summaryDefault?.recentInvoices[0].item).toBe('Botox facial');
      expect(rankedDefault?.topProduct).toBe('Botox facial');
      expect(summaryDefault).toMatchObject({ purchased: true, reservedOnly: false });

      // Custom rule that never names "reserva" ⇒ nothing on this invoice is a
      // deposit, so the priciest line ("Reserva de cita", 400) wins both.
      await setRule({ keywords: ['adelanto'], label: 'Adelanto' });
      const summaryCustom = await contactFinanceSummary(ctx, ids.unscored);
      const rankedCustom = await topProductOf();
      expect(summaryCustom?.recentInvoices[0].item).toBe('Reserva de cita');
      expect(rankedCustom?.topProduct).toBe('Reserva de cita');

      // Explicitly empty keywords ⇒ same selection, reached by the total-`false`
      // predicate rather than by a non-matching keyword. A dropped predicate
      // would be indistinguishable in the flags but shows up here.
      await setRule({ keywords: [], label: 'None' });
      const summaryEmpty = await contactFinanceSummary(ctx, ids.unscored);
      const rankedEmpty = await topProductOf();
      expect(summaryEmpty?.recentInvoices[0].item).toBe('Reserva de cita');
      expect(rankedEmpty?.topProduct).toBe('Reserva de cita');

      // Arithmetic invariant: only classification and selection move.
      for (const s of [summaryCustom, summaryEmpty]) {
        expect(s?.revenue).toBe(summaryDefault?.revenue);
        expect(s?.invoices).toBe(summaryDefault?.invoices);
        expect(s?.recentInvoices).toHaveLength(summaryDefault!.recentInvoices.length);
        expect(s?.recentInvoices[0].total).toBe(summaryDefault!.recentInvoices[0].total);
      }
      for (const r of [rankedCustom, rankedEmpty]) {
        expect(r?.revenue).toBe(rankedDefault?.revenue);
        expect(r?.invoices).toBe(rankedDefault?.invoices);
      }

      expect(warn).not.toHaveBeenCalled();
    } finally {
      financeOn = false;
      warn.mockRestore();
      await client!.unsafe(`delete from crm_settings where org_id = $1`, [org]);
    }
  });
});
