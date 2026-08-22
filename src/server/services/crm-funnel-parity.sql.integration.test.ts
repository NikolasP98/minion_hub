import postgres from 'postgres';
import { loadEnv } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  FUNNEL_ORDER,
  FUNNEL_LEGACY_ALIASES,
  effectiveFunnelStage,
  financeFloorStage,
  maxFunnelStage,
  type FunnelStage,
} from '$lib/components/crm/crm-funnel';

/**
 * Truth-table parity between the SQL `funnel_stage` column (crm-contacts.service)
 * and the TS helpers the client derives the funnel column from. Slice 2 of
 * 2026-08-13-crm-customers-server-pagination-spec moves the funnel filter into
 * SQL so one PAGE of rows can be filtered by it; the two derivations must agree
 * on every combination of (_funnel value × inbound>0 × finance class), or the
 * server page silently disagrees with the column the user is looking at.
 *
 * Postgres-backed by necessity: the whole point is what the database computes.
 * Runs in the CI "Real-PostgreSQL CRM pagination suite" job; skipped (loudly, if
 * REQUIRE_CRM_FUNNEL_PARITY_POSTGRES is set) without a database.
 */
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

if (process.env.REQUIRE_CRM_FUNNEL_PARITY_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_CRM_FUNNEL_PARITY_POSTGRES is set but SUPABASE_DB_URL is empty — the dedicated ' +
      'CRM contacts PostgreSQL job must provide it.',
  );
}

const dialect = new PgDialect();
const client = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 })
  : null;
const schema = `crm_funnel_${process.pid}_${Math.random().toString(36).slice(2)}`;

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_scope: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const query = dialect.sqlToQuery(statement);
        return client!.unsafe(query.sql, query.params as never[]);
      },
    }),
}));
// The funnel FLOOR only exists when CRM + Finances are both on — which is the
// configuration this parity table is about.
vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: async () => true,
}));

import { rankContactsPage } from './crm-contacts.service';
import { contactFinanceMap } from './crm-finance.service';

const org = '00000000-0000-4000-8000-0000000000aa';
const ctx = { db: {} as never, tenantId: org };
const uuid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

/** The closed `_funnel` value domain: current ids, legacy ids, and the shapes
 *  readFunnelMeta rejects (unknown id, non-object blob, absent key). */
const FUNNEL_VALUES: { label: string; customFields: Record<string, unknown> }[] = [
  ...FUNNEL_ORDER.map((stage) => ({
    label: `stored:${stage}`,
    customFields: { _funnel: { stage, auto: true } },
  })),
  ...Object.keys(FUNNEL_LEGACY_ALIASES).map((stage) => ({
    label: `legacy:${stage}`,
    customFields: { _funnel: { stage, auto: true } },
  })),
  { label: 'unknown-id', customFields: { _funnel: { stage: 'bogus', auto: true } } },
  { label: 'scalar-blob', customFields: { _funnel: 'lead' } },
  { label: 'absent', customFields: {} },
];

/** Finance classes, expressed as the invoice lines that produce them. The
 *  deposit rule is the module default (`reserva`), so a "Reserva" line is a
 *  booking deposit and anything else is a real procedure. */
const FIN_CLASSES: { label: string; invoices: { day: number; item: string }[] }[] = [
  { label: 'none', invoices: [] },
  { label: 'booked', invoices: [{ day: 10, item: 'Reserva de cita' }] },
  { label: 'purchased', invoices: [{ day: 20, item: 'Botox' }] },
  {
    label: 'loyal',
    invoices: [
      { day: 30, item: 'Botox' },
      { day: 40, item: 'Relleno' },
    ],
  },
];

type Case = {
  id: string;
  label: string;
  customFields: Record<string, unknown>;
  inbound: number;
  fin: (typeof FIN_CLASSES)[number];
};

const cases: Case[] = [];
for (const value of FUNNEL_VALUES)
  for (const inbound of [0, 2])
    for (const fin of FIN_CLASSES)
      cases.push({
        id: uuid(cases.length + 1),
        label: `${value.label} × inbound=${inbound} × ${fin.label}`,
        customFields: value.customFields,
        inbound,
        fin,
      });

describe.runIf(Boolean(databaseUrl))('SQL funnel_stage vs the TS funnel helpers', () => {
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
        id uuid primary key, client_id uuid, issued_at timestamptz, total numeric,
        shadowed boolean not null default false
      );
      create table fin_invoice_items (invoice_id uuid, description text, total numeric);
    `);
    await client!.unsafe(`select set_config('app.current_org_id', $1, false)`, [org]);

    let seq = 100_000;
    for (const c of cases) {
      await client!.unsafe(
        `insert into crm_contacts (id, display_name, custom_fields, org_id) values ($1, $2, $3, $4)`,
        [c.id, c.label, JSON.stringify(c.customFields), org],
      );
      if (c.inbound > 0) {
        const external = `ext-${c.id}`;
        await client!.unsafe(
          `insert into crm_contact_identities (contact_id, org_id, channel, external_id)
           values ($1, $2, 'whatsapp', $3)`,
          [c.id, org, external],
        );
        for (let i = 0; i < c.inbound; i++)
          await client!.unsafe(
            `insert into messages (org_id, channel, chat_id, occurred_at, created_at, direction, is_bot)
             values ($1, 'whatsapp', $2, now() - interval '1 day', now(), 'inbound', false)`,
            [org, external],
          );
      }
      if (c.fin.invoices.length > 0) {
        const party = uuid(++seq);
        const finClient = uuid(++seq);
        await client!.unsafe(`update crm_contacts set party_id = $1 where id = $2`, [party, c.id]);
        await client!.unsafe(`insert into parties (id) values ($1)`, [party]);
        await client!.unsafe(`insert into fin_clients (id, org_id, party_id) values ($1, $2, $3)`, [
          finClient,
          org,
          party,
        ]);
        for (const inv of c.fin.invoices) {
          const invoiceId = uuid(++seq);
          await client!.unsafe(
            `insert into fin_invoices (id, client_id, issued_at, total)
             values ($1, $2, now() - ($3 || ' days')::interval, 100)`,
            [invoiceId, finClient, String(inv.day)],
          );
          await client!.unsafe(
            `insert into fin_invoice_items (invoice_id, description, total) values ($1, $2, 100)`,
            [invoiceId, inv.item],
          );
        }
      }
    }
  });

  afterAll(async () => {
    if (!client) return;
    await client.unsafe(`drop schema if exists ${schema} cascade`);
    await client.end({ timeout: 5 });
  });

  /** The roster the client used to derive the funnel from, plus the finance map
   *  the client's `funnelOf()` reads — i.e. exactly the two inputs of the
   *  pre-pagination client derivation. */
  async function tsExpectations() {
    const page = await rankContactsPage(ctx, { limit: cases.length + 10 });
    const fin = await contactFinanceMap(ctx);
    return page.rows.map((row) => ({
      row,
      expected: maxFunnelStage(
        effectiveFunnelStage(row.custom_fields, { inbound: row.inbound_msgs }),
        financeFloorStage(fin[row.contact_id] ?? null),
      ),
    }));
  }

  it('agrees with maxFunnelStage(effectiveFunnelStage, financeFloorStage) on every combination', async () => {
    const table = await tsExpectations();
    expect(table).toHaveLength(cases.length);
    const mismatches = table
      .filter((t) => t.row.funnel_stage !== t.expected)
      .map((t) => `${t.row.display_name}: sql=${t.row.funnel_stage} ts=${t.expected}`);
    expect(mismatches).toEqual([]);
    // Non-vacuity: the table must actually exercise every stage AND the "nothing
    // reached yet" null — a fixture that only ever produced `lead` would pass
    // against a hardcoded expression.
    expect(new Set(table.map((t) => t.expected))).toEqual(
      new Set([...FUNNEL_ORDER, null] as (FunnelStage | null)[]),
    );
  });

  it.each(FUNNEL_ORDER)('filters funnelStage=%s to exactly the TS-derived set', async (stage) => {
    const table = await tsExpectations();
    const expected = table.filter((t) => t.expected === stage).map((t) => t.row.contact_id);
    expect(expected.length).toBeGreaterThan(0);

    const filtered = await rankContactsPage(ctx, { funnelStage: stage, limit: cases.length + 10 });
    expect(new Set(filtered.rows.map((r) => r.contact_id))).toEqual(new Set(expected));
    expect(filtered.total).toBe(expected.length);
  });

  it('pages a funnel-filtered set without leaking rows from other stages', async () => {
    const table = await tsExpectations();
    const expected = table.filter((t) => t.expected === 'lead').map((t) => t.row.contact_id);
    const seen: string[] = [];
    for (let offset = 0; offset < expected.length; offset += 3) {
      const page = await rankContactsPage(ctx, { funnelStage: 'lead', limit: 3, offset });
      expect(page.total).toBe(expected.length);
      seen.push(...page.rows.map((r) => r.contact_id));
    }
    expect(new Set(seen)).toEqual(new Set(expected));
    expect(seen).toHaveLength(expected.length);
  });
});
