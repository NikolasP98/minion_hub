import postgres from 'postgres';
import { loadEnv } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

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

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_scope: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const query = dialect.sqlToQuery(statement);
        return client!.unsafe(query.sql, query.params as never[]);
      },
    }),
}));
// The finance bridge (and with it the revenue column `sort:'revenue'` orders by)
// is only built when BOTH modules are on, so the flag has to be switchable here.
let financeOn = false;
vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: async () => financeOn,
}));

import { rankContactsPage } from './crm-contacts.service';
import { contactFinanceMap } from './crm-finance.service';

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
      create table fin_invoices (
        id uuid primary key, client_id uuid, issued_at timestamptz, total numeric
      );
      create table fin_invoice_items (invoice_id uuid, description text, total numeric);
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
    expect(empty).toEqual({ rows: [], total: count });
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

  it('a masked principal cannot probe the phone/DNI digits the mask hides', async () => {
    const page = await rankContactsPage(
      { db: {} as never, tenantId: org },
      { search: '5198', limit: 20, maskSensitive: true },
    );
    expect(page).toEqual({ rows: [], total: 0 });
  });

  it.each(['8765', '5566'])('does not match phone/DNI mid-string %s', async (search) => {
    const page = await rankContactsPage({ db: {} as never, tenantId: org }, { search, limit: 20 });
    expect(page).toEqual({ rows: [], total: 0 });
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
});
