import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { SQL } from 'drizzle-orm';

/**
 * Executed-SQL proof for crm-journey.service.ts's deterministic finance query
 * and its resolved `DepositRule` (S1 of
 * 2026-08-20-handoff-minion-hub-2131866440-spec, extending S2 of
 * 2026-08-17-hub-reserva-keyword-config-spec). `crm-deposit-rule.sql.integration.test.ts`
 * proves the shared `depositMatchSql`/`notDepositMatchSql` predicates against
 * real PostgreSQL ILIKE in isolation; this file proves the same predicates
 * AND the `resolveDepositRule` settings read through the actual
 * `contactJourney` query path — default (absent config), a custom rule read
 * from `crm_settings`, and the explicitly-empty-keywords contract.
 *
 * Runs against pglite (real, WASM-embedded Postgres — same engine as
 * crm-journey.atomic-write.test.ts and crm-contacts.service.test.ts), not a
 * SUPABASE_DB_URL-gated external service: this suite executes unconditionally
 * as part of the normal test run rather than skipping when no external
 * database is provisioned, per the operator-memory note that a skipped
 * integration case is not passing evidence. Every org_id column is TEXT,
 * matching production (pg-crm-schema.ts / pg-finance-schema.ts).
 */

/** The tx handed to the service; only `execute` is shape-sensitive. */
interface ExecTx {
  execute: (query: SQL) => Promise<unknown>;
}

/**
 * Production runs on postgres-js, whose `execute()` resolves to the row
 * ARRAY; pglite's resolves to a `{ rows, fields }` result object, and
 * `deterministicMilestones` iterates the array shape directly. Adapts pglite
 * to the production driver's shape; every other member (`select`/`from`/…)
 * passes straight through to the real transaction.
 */
function withPgDriverShape<T extends ExecTx>(tx: T): T {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return async (query: SQL) => {
          const res = (await target.execute(query)) as { rows?: unknown[] } | unknown[];
          return Array.isArray(res) ? res : (res?.rows ?? []);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (
    scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } },
    fn: (tx: unknown) => unknown,
  ) => scope.db.transaction((tx: unknown) => fn(withPgDriverShape(tx as ExecTx))),
}));
vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: async () => true,
}));

import { contactJourney } from './crm-journey.service';

// text org_id (production shape on every crm-*/fin-* table) — three separate
// orgs so each can carry its own crm_settings.value.deposit row (or none).
const orgDefault = 'journey-org-default';
const orgCustom = 'journey-org-custom';
const orgEmpty = 'journey-org-empty';

let client: PGlite;
let db: ReturnType<typeof drizzle>;

async function setOrg(org: string) {
  await client.exec(`select set_config('app.current_org_id', '${org}', false);`);
}

/** Seeds one contact with a party/finance client and a single invoice bearing `items`. */
async function seedInvoicedContact(org: string, items: string[]): Promise<string> {
  const contactId = crypto.randomUUID();
  const party = crypto.randomUUID();
  const finClient = crypto.randomUUID();
  const invoice = crypto.randomUUID();
  await client.query(
    `insert into crm_contacts (id, display_name, custom_fields, org_id, party_id) values ($1, $2, '{}', $3, $4)`,
    [contactId, contactId, org, party],
  );
  await client.query(`insert into parties (id) values ($1)`, [party]);
  await client.query(`insert into fin_clients (id, org_id, party_id) values ($1, $2, $3)`, [
    finClient,
    org,
    party,
  ]);
  await client.query(
    `insert into fin_invoices (id, client_id, issued_at, total) values ($1, $2, now(), 100)`,
    [invoice, finClient],
  );
  for (const item of items) {
    await client.query(
      `insert into fin_invoice_items (invoice_id, description, total) values ($1, $2, 100)`,
      [invoice, item],
    );
  }
  return contactId;
}

describe('contactJourney deterministic finance milestones against a real Postgres engine (pglite)', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client);
    await client.exec(`
      create table crm_contacts (
        id uuid primary key, display_name text, owner_id uuid, source text,
        lifecycle_override text, custom_fields jsonb not null default '{}',
        party_id uuid, deleted_at timestamptz, org_id text,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      -- org_id is TEXT in production on every table below (pg-crm-schema,
      -- pg-finance-schema); typing it uuid here breaks any predicate that
      -- compares it to current_setting('app.current_org_id') instead of a
      -- bound parameter.
      create table crm_contact_identities (
        contact_id uuid, org_id text, channel text, external_id text, handle text
      );
      create table meta_lead_attribution (
        org_id text, channel text, sender_id text, origin text,
        campaign_name text, first_contact_at timestamptz
      );
      create table crm_contact_stats (contact_id uuid, first_contact_at timestamptz);
      create table sched_bookings (
        id uuid primary key, start_time timestamptz, title text, status text,
        org_id text, crm_contact_id uuid, party_id uuid
      );
      create table parties (id uuid primary key);
      create table fin_clients (id uuid primary key, org_id text, party_id uuid);
      create table fin_invoices (
        id uuid primary key, client_id uuid, issued_at timestamptz, total numeric, status text
      );
      create table fin_invoice_items (invoice_id uuid, description text, total numeric);
      create table crm_settings (
        org_id text primary key, value jsonb not null default '{}',
        updated_at timestamptz not null default now()
      );
    `);

    // orgDefault: no crm_settings row at all — absent config, default rule.
    ids.depositOnlyDefault = await seedInvoicedContact(orgDefault, ['Reserva de Consulta']);
    ids.mixedDefault = await seedInvoicedContact(orgDefault, [
      'Reserva de Consulta',
      'Botox completo',
    ]);
    ids.nonDepositDefault = await seedInvoicedContact(orgDefault, ['Botox completo']);
    // Tie fixture: procedure line must win representative-item ordering at equal price.
    ids.tieDefault = await seedInvoicedContact(orgDefault, [
      'Reserva de Consulta',
      'Botox completo',
    ]);

    // orgCustom: keywords ['adelanto', 'seña'], custom label — 'reserva' text
    // must NOT classify as a deposit under this rule.
    await client.query(`insert into crm_settings (org_id, value) values ($1, $2::jsonb)`, [
      orgCustom,
      JSON.stringify({ deposit: { keywords: ['adelanto', 'seña'], label: 'Deposit paid' } }),
    ]);
    ids.depositOnlyCustom = await seedInvoicedContact(orgCustom, ['Dejó una seña']);
    ids.mixedCustom = await seedInvoicedContact(orgCustom, [
      'Adelanto de reserva',
      'Relleno de labios',
    ]);

    // orgEmpty: explicit keywords: [] — no item is ever a deposit.
    await client.query(`insert into crm_settings (org_id, value) values ($1, $2::jsonb)`, [
      orgEmpty,
      JSON.stringify({ deposit: { keywords: [] } }),
    ]);
    ids.nonDepositEmpty = await seedInvoicedContact(orgEmpty, ['Reserva de Consulta']);
  });

  afterAll(async () => {
    await client.close();
  });

  const invoiceMilestone = (journey: Awaited<ReturnType<typeof contactJourney>>) =>
    journey.find((m) => m.type === 'reserve' || m.type === 'purchase');

  it('DEFAULT (absent config): a deposit-only invoice produces a reserve milestone labelled "Reserved a consult"', async () => {
    await setOrg(orgDefault);
    const journey = await contactJourney(
      { db: db as never, tenantId: orgDefault },
      ids.depositOnlyDefault,
    );
    expect(invoiceMilestone(journey)).toMatchObject({
      type: 'reserve',
      label: 'Reserved a consult',
    });
  });

  it('DEFAULT (absent config): a mixed invoice produces a purchase milestone labelled from the non-deposit item', async () => {
    await setOrg(orgDefault);
    const journey = await contactJourney(
      { db: db as never, tenantId: orgDefault },
      ids.mixedDefault,
    );
    expect(invoiceMilestone(journey)).toMatchObject({ type: 'purchase', label: 'Botox completo' });
  });

  it('DEFAULT (absent config): a non-deposit invoice produces a purchase milestone', async () => {
    await setOrg(orgDefault);
    const journey = await contactJourney(
      { db: db as never, tenantId: orgDefault },
      ids.nonDepositDefault,
    );
    expect(invoiceMilestone(journey)).toMatchObject({ type: 'purchase', label: 'Botox completo' });
  });

  it('DEFAULT (absent config): representative-item ordering puts the procedure line before the deposit line at equal price', async () => {
    await setOrg(orgDefault);
    const journey = await contactJourney({ db: db as never, tenantId: orgDefault }, ids.tieDefault);
    expect(invoiceMilestone(journey)).toMatchObject({ type: 'purchase', label: 'Botox completo' });
  });

  it('CUSTOM RULE: a deposit-only invoice matched by a configured keyword produces the configured reserve label', async () => {
    await setOrg(orgCustom);
    const journey = await contactJourney(
      { db: db as never, tenantId: orgCustom },
      ids.depositOnlyCustom,
    );
    expect(invoiceMilestone(journey)).toMatchObject({ type: 'reserve', label: 'Deposit paid' });
  });

  it('CUSTOM RULE: "reserva" text alone does not classify as a deposit — the default keyword is not silently retained', async () => {
    await setOrg(orgCustom);
    const journey = await contactJourney({ db: db as never, tenantId: orgCustom }, ids.mixedCustom);
    // "Adelanto de reserva" matches the configured 'adelanto' keyword (deposit);
    // "Relleno de labios" does not — so this invoice is mixed, not deposit-only,
    // and the non-deposit item wins as the purchase label.
    expect(invoiceMilestone(journey)).toMatchObject({
      type: 'purchase',
      label: 'Relleno de labios',
    });
  });

  it('EMPTY KEYWORDS: a non-null item is always a purchase, even when its text matches the default deposit vocabulary', async () => {
    await setOrg(orgEmpty);
    const journey = await contactJourney(
      { db: db as never, tenantId: orgEmpty },
      ids.nonDepositEmpty,
    );
    expect(invoiceMilestone(journey)).toMatchObject({
      type: 'purchase',
      label: 'Reserva de Consulta',
    });
  });
});
