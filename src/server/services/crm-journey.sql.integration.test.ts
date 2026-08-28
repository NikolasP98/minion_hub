import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Executes `deterministicMilestones`' finance query — and `resolveDepositRule`'s
 * `crm_settings` read — against a real embedded Postgres engine (PGlite). The
 * mocked-db tests in `crm-journey.service.test.ts` inject `has_proc`/`item`
 * directly and only prove the JS-side row→field mapping; this file is the
 * query-path proof that a real ILIKE/ORDER BY evaluation, for the default,
 * a configured, and an explicitly empty rule, actually classifies a real
 * invoice-item row the way the mapping tests assume. PGlite is embedded (no
 * external service, no env-gated `SUPABASE_DB_URL`), so these cases can never
 * silently skip for a missing DB prerequisite — see
 * 2026-08-20-handoff-minion-hub-2131866440-spec §6.
 *
 * `org_id` is `text` on every fixture table here, matching production
 * (pg-crm-schema.ts / pg-finance-schema.ts) — a `uuid` fixture would hide a
 * `uuid = text` mismatch against the GUC-based predicates these queries share
 * with crm-finance.service.ts (see the CRM-fixture-drift memory note).
 */

const dialect = new PgDialect();

vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: async () => true,
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

let client: PGlite;
let orm: ReturnType<typeof drizzle>;

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_scope: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (statement: SQL) => {
        const { sql: text, params } = dialect.sqlToQuery(statement);
        const res = await client.query(text, params as unknown[]);
        return res.rows;
      },
      select: (...args: Parameters<typeof orm.select>) => orm.select(...args),
    }),
}));

import { contactJourney } from './crm-journey.service';

const ORG = 'org-1';

async function setup() {
  client = new PGlite();
  orm = drizzle(client);
  await client.exec(`
    create table crm_contacts (
      id uuid primary key,
      org_id text not null,
      human_id text,
      display_name text,
      profile_id uuid,
      owner_id uuid,
      party_id uuid,
      lifecycle_override text,
      source text not null default 'harvested',
      custom_fields jsonb not null default '{}'::jsonb,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table fin_clients (id uuid primary key, org_id text not null, party_id uuid);
    create table fin_invoices (
      id uuid primary key, client_id uuid, issued_at timestamptz, total numeric,
        shadowed boolean not null default false, status text
    );
    create table fin_invoice_items (invoice_id uuid, description text, total numeric);
    create table sched_bookings (
      id uuid primary key, org_id text not null, crm_contact_id uuid, party_id uuid,
      start_time timestamptz, title text, status text
    );
    create table crm_contact_stats (contact_id uuid primary key, first_contact_at timestamptz);
    create table crm_contact_identities (
      org_id text not null, contact_id uuid not null, channel text not null, external_id text not null
    );
    create table meta_lead_attribution (
      org_id text not null, channel text not null, sender_id text not null,
      origin text, campaign_name text, first_contact_at timestamptz
    );
    create table crm_settings (
      org_id text primary key, value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
  await client.exec(`select set_config('app.current_org_id', '${ORG}', false);`);
}

async function seedInvoice(items: Array<[string, number]>) {
  const contactId = crypto.randomUUID();
  const partyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  await client.query(`insert into crm_contacts (id, org_id, party_id) values ($1, $2, $3)`, [
    contactId,
    ORG,
    partyId,
  ]);
  await client.query(`insert into fin_clients (id, org_id, party_id) values ($1, $2, $3)`, [
    clientId,
    ORG,
    partyId,
  ]);
  const total = items.reduce((sum, [, t]) => sum + t, 0);
  await client.query(
    `insert into fin_invoices (id, client_id, issued_at, total) values ($1, $2, now(), $3)`,
    [invoiceId, clientId, total],
  );
  for (const [description, itemTotal] of items) {
    await client.query(
      `insert into fin_invoice_items (invoice_id, description, total) values ($1, $2, $3)`,
      [invoiceId, description, itemTotal],
    );
  }
  return contactId;
}

async function setDepositConfig(deposit: unknown) {
  await client.query(
    `insert into crm_settings (org_id, value) values ($1, $2::jsonb)
     on conflict (org_id) do update set value = excluded.value`,
    [ORG, JSON.stringify({ deposit })],
  );
}

const journeyOf = (ctx: { db: never; tenantId: string }, contactId: string) =>
  contactJourney(ctx, contactId);
const invoiceMilestone = (journey: Awaited<ReturnType<typeof contactJourney>>) =>
  journey.find((m) => m.id.startsWith('inv:'));

describe('deterministicMilestones deposit classification against PGlite', () => {
  beforeEach(setup);
  afterEach(async () => {
    await client.close();
  });

  it('absent config: the default "reserva" keyword classifies a deposit-only invoice as reserve/"Reserved a consult"', async () => {
    const contactId = await seedInvoice([['Reserva de cita', 50]]);
    const journey = await journeyOf({ db: {} as never, tenantId: ORG }, contactId);
    expect(invoiceMilestone(journey)).toMatchObject({
      type: 'reserve',
      label: 'Reserved a consult',
    });
  });

  it('absent config: a mixed invoice (procedure + deposit) is a purchase, labelled from the procedure item', async () => {
    const contactId = await seedInvoice([
      ['Reserva de cita', 400],
      ['Botox facial', 100],
    ]);
    const journey = await journeyOf({ db: {} as never, tenantId: ORG }, contactId);
    expect(invoiceMilestone(journey)).toMatchObject({ type: 'purchase', label: 'Botox facial' });
  });

  it('custom rule: "reserva" no longer matches, so the same line item becomes a purchase', async () => {
    await setDepositConfig({ keywords: ['adelanto', 'seña'], label: 'Deposit paid' });
    const contactId = await seedInvoice([['Reserva de cita', 50]]);
    const journey = await journeyOf({ db: {} as never, tenantId: ORG }, contactId);
    expect(invoiceMilestone(journey)).toMatchObject({
      type: 'purchase',
      label: 'Reserva de cita',
    });
  });

  it('custom rule: a deposit-only invoice under the configured keyword uses the configured label', async () => {
    await setDepositConfig({ keywords: ['adelanto', 'seña'], label: 'Deposit paid' });
    const contactId = await seedInvoice([['Pagó un adelanto', 50]]);
    const journey = await journeyOf({ db: {} as never, tenantId: ORG }, contactId);
    expect(invoiceMilestone(journey)).toMatchObject({ type: 'reserve', label: 'Deposit paid' });
  });

  it('malformed config: a non-object stored deposit value warns once and falls back to the default rule, same as absent config', async () => {
    await setDepositConfig('not-an-object');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const contactId = await seedInvoice([['Reserva de cita', 50]]);
    const journey = await journeyOf({ db: {} as never, tenantId: ORG }, contactId);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('crm_settings.value.deposit is malformed'),
    );
    expect(invoiceMilestone(journey)).toMatchObject({
      type: 'reserve',
      label: 'Reserved a consult',
    });
    warnSpy.mockRestore();
  });

  it('empty keywords: nothing is ever a deposit, so a non-null item always produces purchase, not reserve', async () => {
    await setDepositConfig({ keywords: [], label: 'None' });
    const contactId = await seedInvoice([['Reserva de cita', 50]]);
    const journey = await journeyOf({ db: {} as never, tenantId: ORG }, contactId);
    expect(invoiceMilestone(journey)).toMatchObject({
      type: 'purchase',
      label: 'Reserva de cita',
    });
  });

  it('a same-tenant rule change is visible on the immediately next call: default → custom → empty → back to absent', async () => {
    const contactId = await seedInvoice([['Reserva de cita', 50]]);
    const ctx = { db: {} as never, tenantId: ORG };

    const withDefault = invoiceMilestone(await journeyOf(ctx, contactId));
    expect(withDefault).toMatchObject({ type: 'reserve', label: 'Reserved a consult' });

    await setDepositConfig({ keywords: ['adelanto'], label: 'Adelanto' });
    const withCustom = invoiceMilestone(await journeyOf(ctx, contactId));
    expect(withCustom).toMatchObject({ type: 'purchase', label: 'Reserva de cita' });

    await setDepositConfig({ keywords: [], label: 'None' });
    const withEmpty = invoiceMilestone(await journeyOf(ctx, contactId));
    expect(withEmpty).toMatchObject({ type: 'purchase', label: 'Reserva de cita' });

    await client.query(`delete from crm_settings where org_id = $1`, [ORG]);
    const backToAbsent = invoiceMilestone(await journeyOf(ctx, contactId));
    expect(backToAbsent).toMatchObject({ type: 'reserve', label: 'Reserved a consult' });
  });
});
