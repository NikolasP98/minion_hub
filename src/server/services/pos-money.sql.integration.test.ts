import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schemaTypes from '@minion-stack/db/pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
import {
  addLedgerEntry,
  cancelPlan,
  createPlan,
  creditBalance,
  creditBalances,
  getPlan,
  listPlans,
  listLedger,
  addLedgerEntryInTx,
  settlePlanIfPaid,
  type PlanInput,
} from './pos-accounts.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { createGrantsForTicketLine } from './pos-packages.service';
import { requireGrantSourceCurrencies } from './pos/grant-money';
import { cancelPlanOperation, lookupOwnPlanOperation, planRequestHash } from './pos/plan-operation';
import { resolveWalletIdentity, resolveWalletIdentityForAdmission } from './pos/wallet-identity';
import { getPosSettingsInTx, voidTicket } from './pos.service';
import { lockGrantSources, lockPosIdentityShared, lockPosWalletExclusive } from './pos/lock-key';
import { moneyNumber } from './pos/money';
import { validateDueSchedule } from './pos/payment-plan-schedule';

let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: ReturnType<typeof harness.createConnection>;
let ctx: CoreCtx;
let createdPublicLockFunction = false;
const fixtureSchema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
const ORG = 'pos-money-native-org';
const OTHER = 'pos-money-native-other';
const ACTOR = '40000000-0000-4000-8000-000000000001';
const OTHER_ACTOR = '40000000-0000-4000-8000-000000000002';
const client = {
  partyId: '10000000-0000-4000-8000-000000000001',
  crmContactId: '10000000-0000-4000-8000-000000000002',
};
const CLIENT_KEY = `party:${client.partyId}`;
const OTHER_PARTY = '10000000-0000-4000-8000-000000000003';
const OTHER_CONTACT = '10000000-0000-4000-8000-000000000004';
const ALT_PARTY = '10000000-0000-4000-8000-000000000005';
const BOOKING = '20000000-0000-4000-8000-000000000001';
const FOREIGN_BOOKING = '20000000-0000-4000-8000-000000000002';
const tables = [
  'pos_payment_plans',
  'pos_client_ledger',
  'sched_bookings',
  'pos_tickets',
  'pos_ticket_lines',
  'pos_payments',
  'pos_package_redemptions',
  'pos_package_grants',
  'pos_settings',
  'crm_contacts',
  'parties',
];
const input = (patch: Partial<PlanInput> = {}): PlanInput => {
  const value: PlanInput = {
    client,
    title: 'Disposable agreement',
    totalAmount: 100,
    currency: 'PEN',
    ...patch,
  };
  if (value.operationId !== undefined && !Object.hasOwn(patch, 'clientKey')) {
    value.clientKey = CLIENT_KEY;
  }
  return value;
};

beforeAll(async () => {
  // No implicit application URL or optional skip: identity and disposable marker are mandatory.
  harness = await openDisposablePostgres();
  await harness.owner.unsafe(`CREATE SCHEMA "${fixtureSchema}"`);
  owner = harness.createConnection(fixtureSchema);
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20260914000000_pos_packages_plans.sql', import.meta.url),
    'utf8',
  );
  for (const table of ['pos_client_ledger', 'pos_payment_plans']) {
    const start = migration.indexOf(`create table if not exists public.${table} (`);
    const end = migration.indexOf('--> statement-breakpoint', start);
    if (start < 0 || end <= start) throw new Error(`Missing production DDL for ${table}`);
    await owner.unsafe(migration.slice(start, end).replaceAll('public.', `"${fixtureSchema}".`));
  }
  await owner.unsafe(`
    CREATE TABLE sched_bookings (id uuid PRIMARY KEY, org_id text NOT NULL, payment_plan_id uuid, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE pos_shifts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      status text NOT NULL DEFAULT 'open', opened_by uuid, opened_at timestamptz NOT NULL DEFAULT now(),
      opening_float jsonb NOT NULL DEFAULT '{}', closed_by uuid, closed_at timestamptz,
      expected jsonb, counted jsonb, note text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE pos_tickets (
      id uuid PRIMARY KEY, org_id text NOT NULL, human_id text,
      shift_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000',
      party_id uuid, crm_contact_id uuid, customer_name text,
      status text NOT NULL, subtotal numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0,
      total numeric NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'PEN', note text,
      stock_entry_id uuid, stock_warning jsonb, invoice_provider_ref text, created_by uuid,
      submitted_at timestamptz NOT NULL DEFAULT now(), voided_at timestamptz, voided_by uuid,
      metadata jsonb NOT NULL DEFAULT '{}'
    );
    CREATE TABLE pos_ticket_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      ticket_id uuid NOT NULL REFERENCES pos_tickets(id), kind text NOT NULL DEFAULT 'custom',
      fin_product_id uuid, booking_id uuid, description text NOT NULL DEFAULT 'fixture',
      qty numeric NOT NULL DEFAULT 1, unit_price numeric NOT NULL DEFAULT 0,
      discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL, line_no integer NOT NULL DEFAULT 0,
      modifiers jsonb NOT NULL DEFAULT '[]', plan_id uuid, redemption_id uuid
    );
    CREATE TABLE pos_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      ticket_id uuid NOT NULL REFERENCES pos_tickets(id), shift_id uuid NOT NULL,
      method text NOT NULL, amount numeric NOT NULL, tendered numeric,
      paid_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'
    );
    CREATE TABLE pos_package_redemptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      grant_id uuid NOT NULL, booking_id uuid, ticket_id uuid, ticket_line_id uuid,
      redeemed_at timestamptz NOT NULL DEFAULT now(), redeemed_by uuid,
      reversed_at timestamptz, reversed_by uuid, reversal_reason text
    );
    CREATE TABLE pos_settings (
      org_id text PRIMARY KEY,
      methods jsonb NOT NULL DEFAULT '["cash","card","yape","plin","transfer"]',
      currency text NOT NULL DEFAULT 'PEN',
      surcharges jsonb NOT NULL DEFAULT '{}',
      require_customer boolean NOT NULL DEFAULT false,
      allow_price_override boolean NOT NULL DEFAULT true,
      emission jsonb NOT NULL DEFAULT '{"mode":"off","docTypeDefault":"03"}',
      requirements jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE parties (
      id uuid PRIMARY KEY,
      org_id text NOT NULL,
      name text,
      doc_number text,
      phone9 text
    );
    CREATE TABLE crm_contacts (
      id uuid PRIMARY KEY,
      org_id text NOT NULL,
      party_id uuid,
      display_name text,
      deleted_at timestamptz
    );
  `);
  const grantStart = migration.indexOf('create table if not exists public.pos_package_grants (');
  const grantEnd = migration.indexOf('--> statement-breakpoint', grantStart);
  if (grantStart < 0 || grantEnd <= grantStart) throw new Error('Missing production grant DDL');
  await owner.unsafe(
    migration.slice(grantStart, grantEnd).replaceAll('public.', `"${fixtureSchema}".`),
  );
  await owner.unsafe(`
    GRANT USAGE ON SCHEMA "${fixtureSchema}" TO app_ledger;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${fixtureSchema}" TO app_ledger;
  `);
  for (const table of tables)
    await owner.unsafe(`
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
    CREATE POLICY fixture_org ON ${table} TO app_ledger USING (org_id = current_setting('app.current_org_id', true)) WITH CHECK (org_id = current_setting('app.current_org_id', true));
  `);
  // Exercise the complete forward migration, including its actual grants and RLS policy.
  const operationsMigration = readFileSync(
    new URL('../../../supabase/migrations/20261003120000_pos_plan_operations.sql', import.meta.url),
    'utf8',
  );
  await owner.unsafe(operationsMigration.replaceAll('public.', `"${fixtureSchema}".`));
  const walletMigration = readFileSync(
    new URL('../../../supabase/migrations/20261003130000_pos_wallet_currency.sql', import.meta.url),
    'utf8',
  );
  const existingLockFunction = await harness.owner`
    SELECT to_regprocedure('public.pos_advisory_key_v1(text,text,text,text)') IS NOT NULL AS present
  `;
  if (!existingLockFunction[0].present) {
    const helperEnd = walletMigration.indexOf(
      'CREATE OR REPLACE FUNCTION public.pos_lock_identity_orgs_v1',
    );
    if (helperEnd < 0) throw new Error('Missing production POS lock helper');
    await harness.owner.unsafe(walletMigration.slice(0, helperEnd));
    createdPublicLockFunction = true;
  }
  await owner.unsafe(walletMigration.replaceAll('public.', `"${fixtureSchema}".`));
  const db = drizzle(harness.createConnection(fixtureSchema), { schema: schemaTypes });
  ctx = { tenantId: ORG, db, profileId: ACTOR };
});

beforeEach(async () => {
  await owner.unsafe(`TRUNCATE ${tables.join(', ')}, pos_plan_operation_cancellations CASCADE`);
  await owner`INSERT INTO sched_bookings (id,org_id) VALUES (${BOOKING},${ORG}),(${FOREIGN_BOOKING},${OTHER})`;
  await owner`INSERT INTO parties (id,org_id,name) VALUES (${client.partyId},${ORG},'Fixture client'),(${ALT_PARTY},${ORG},'Alternate client'),(${OTHER_PARTY},${OTHER},'Other client')`;
  await owner`INSERT INTO crm_contacts (id,org_id,party_id,display_name) VALUES (${client.crmContactId},${ORG},${client.partyId},'Fixture contact'),(${OTHER_CONTACT},${OTHER},${OTHER_PARTY},'Other contact')`;
});

afterAll(async () => {
  if (!harness) return;
  try {
    await harness.owner.unsafe(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    if (createdPublicLockFunction) {
      await harness.owner.unsafe(
        'DROP FUNCTION IF EXISTS public.pos_advisory_key_v1(text,text,text,text)',
      );
    }
    const rows =
      await harness.owner`SELECT nspname FROM pg_namespace WHERE nspname=${fixtureSchema}`;
    expect(rows).toHaveLength(0);
  } finally {
    await harness.close();
  }
});

async function planCount() {
  return Number((await owner`SELECT count(*) AS n FROM pos_payment_plans`)[0].n);
}
async function paid(planId: string, amount: string) {
  const ticketId = crypto.randomUUID();
  await owner`INSERT INTO pos_tickets (id,org_id,status) VALUES (${ticketId},${ORG},'submitted')`;
  await owner`INSERT INTO pos_ticket_lines (org_id,ticket_id,plan_id,total) VALUES (${ORG},${ticketId},${planId},${amount})`;
}

describe('native POS decimal and schedule boundaries', () => {
  it('fences package grant currency by the historical source ticket and organization before writing', async () => {
    const ticketId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    const foreignId = crypto.randomUUID();
    await owner`INSERT INTO pos_tickets (id,org_id,status,currency) VALUES (${ticketId},${ORG},'submitted','JPY'),(${foreignId},${OTHER},'submitted','PEN')`;
    await owner`INSERT INTO pos_ticket_lines (id,org_id,ticket_id,total) VALUES (${lineId},${ORG},${ticketId},100)`;
    const mint = (sourceId = ticketId) =>
      withOrgCore(ctx, (tx) =>
        createGrantsForTicketLine(tx, ORG, {
          client,
          line: {
            ticketId: sourceId,
            lineId,
            packageProductId: '30000000-0000-4000-8000-000000000001',
            qty: 1,
            total: 100,
          },
          edges: [{ childProductId: '30000000-0000-4000-8000-000000000002', qty: 2 }],
        }),
      );
    await expect(mint()).rejects.toMatchObject({ code: 'unsupported_pos_currency' });
    await expect(mint(foreignId)).rejects.toMatchObject({ code: 'invalid_stored_amount' });
    expect((await owner`SELECT count(*) AS n FROM pos_package_grants`)[0].n).toBe('0');
    await owner`UPDATE pos_tickets SET currency='PEN' WHERE id=${ticketId}`;
    expect(await mint()).toMatchObject([{ unitValue: '50.00', sessionsTotal: 2 }]);
    await expect(
      owner`UPDATE pos_tickets SET currency='KWD' WHERE id=${ticketId}`,
    ).rejects.toMatchObject({ code: '23503' });
    expect(
      await withOrgCore(ctx, (tx) => requireGrantSourceCurrencies(tx, ORG, [ticketId])),
    ).toEqual(new Map([[ticketId, 'PEN']]));
    expect(await owner`SELECT unit_value::text AS value FROM pos_package_grants`).toEqual([
      { value: '50.00' },
    ]);
  });

  it('persists rounded principal and reconciled dates through the real service and RLS transaction', async () => {
    const plan = await createPlan(
      ctx,
      input({
        totalAmount: 1.005,
        dueSchedule: [
          { dueOn: '2026-11-03', amount: 0.51 },
          { dueOn: '2026-10-03', amount: 0.5 },
        ],
      }),
    );
    expect(plan.totalAmount).toBe('1.01');
    expect(plan.dueSchedule).toEqual([
      { dueOn: '2026-10-03', amount: 0.5 },
      { dueOn: '2026-11-03', amount: 0.51 },
    ]);
    const rows =
      await owner`SELECT total_amount::text AS principal, currency FROM pos_payment_plans WHERE id=${plan.id}`;
    expect(rows).toEqual([{ principal: '1.01', currency: 'PEN' }]);
  });

  it('rejects bad dates, subcent rows, oversized and mismatched schedules without inserting a plan', async () => {
    for (const dueSchedule of [
      [{ dueOn: '2026-02-29', amount: 100 }],
      [{ dueOn: '2026-10-03', amount: 99.999 }],
      [{ dueOn: '2026-10-03', amount: 99.99 }],
      [{ dueOn: '2026-10-03', amount: 100.01 }],
      Array(366).fill({ dueOn: '2026-10-03', amount: 1 }),
    ]) {
      await expect(createPlan(ctx, input({ dueSchedule }))).rejects.toMatchObject({
        code: 'invalid_due_schedule',
      });
      expect(await planCount()).toBe(0);
    }
  });

  it('rejects principal overflow and unsupported currencies before mutation and preserves absent schedules', async () => {
    await expect(createPlan(ctx, input({ totalAmount: 9999999999.995 }))).rejects.toMatchObject({
      code: 'invalid_amount',
    });
    await expect(createPlan(ctx, input({ currency: 'JPY' }))).rejects.toMatchObject({
      code: 'unsupported_pos_currency',
    });
    expect(await planCount()).toBe(0);
    const plan = await createPlan(ctx, input({ dueSchedule: [] }));
    expect(plan.dueSchedule).toBeNull();
    expect((await getPlan(ctx, plan.id))?.scheduleIssue).toBeNull();
    await owner`UPDATE pos_payment_plans SET currency='JPY' WHERE id=${plan.id}`;
    await expect(cancelPlan(ctx, plan.id)).rejects.toMatchObject({
      code: 'unsupported_pos_currency',
    });
    expect((await owner`SELECT status FROM pos_payment_plans WHERE id=${plan.id}`)[0].status).toBe(
      'open',
    );
  });

  it('commits both booking links and rolls back missing, foreign or already funded booking attempts', async () => {
    for (const bookingId of [crypto.randomUUID(), FOREIGN_BOOKING]) {
      await expect(createPlan(ctx, input({ bookingId }))).rejects.toMatchObject({
        code: 'not_found',
      });
      expect(await planCount()).toBe(0);
    }
    const plan = await createPlan(ctx, input({ bookingId: BOOKING }));
    expect(plan.bookingId).toBe(BOOKING);
    expect(
      (await owner`SELECT payment_plan_id FROM sched_bookings WHERE id=${BOOKING}`)[0]
        .payment_plan_id,
    ).toBe(plan.id);
    await expect(createPlan(ctx, input({ bookingId: BOOKING }))).rejects.toMatchObject({
      code: 'booking_already_planned',
    });
    expect(await planCount()).toBe(1);
    expect(
      (await owner`SELECT payment_plan_id FROM sched_bookings WHERE id=${FOREIGN_BOOKING}`)[0]
        .payment_plan_id,
    ).toBeNull();
  });

  it('reads only the unpaid instalment remainder and never offers settled or overpaid principal', async () => {
    const plan = await createPlan(
      ctx,
      input({
        dueSchedule: [
          { dueOn: '2026-10-03', amount: 60 },
          { dueOn: '2026-11-03', amount: 40 },
        ],
      }),
    );
    await paid(plan.id, '40.00');
    expect(await getPlan(ctx, plan.id)).toMatchObject({
      remaining: 60,
      paidToDate: 40,
      nextDue: { amount: 20 },
      scheduleIssue: null,
    });
    await paid(plan.id, '20.00');
    expect(await getPlan(ctx, plan.id)).toMatchObject({ remaining: 40, nextDue: { amount: 40 } });
    await paid(plan.id, '40.00');
    expect(await getPlan(ctx, plan.id)).toMatchObject({
      remaining: 0,
      isPaid: true,
      nextDue: null,
    });
    await paid(plan.id, '10.00');
    expect(await getPlan(ctx, plan.id)).toMatchObject({
      remaining: -10,
      isPaid: true,
      nextDue: null,
    });
    await owner`UPDATE pos_tickets SET currency='JPY' WHERE org_id=${ORG}`;
    await expect(getPlan(ctx, plan.id)).rejects.toMatchObject({
      code: 'unsupported_pos_currency',
    });
  });

  it('keeps legacy schedule corruption visible without hiding valid balance or changing history', async () => {
    const plan = await createPlan(ctx, input());
    await paid(plan.id, '40.00');
    for (const [schedule, issue] of [
      [[{ dueOn: 'soon', amount: 100 }], 'invalid_rows'],
      [[{ dueOn: '2026-10-03', amount: 90 }], 'principal_mismatch'],
    ] as const) {
      await owner`UPDATE pos_payment_plans SET due_schedule=${JSON.stringify(schedule)}::text::jsonb WHERE id=${plan.id}`;
      expect(await getPlan(ctx, plan.id)).toMatchObject({
        remaining: 60,
        paidToDate: 40,
        nextDue: null,
        scheduleIssue: issue,
      });
      expect(
        (await owner`SELECT due_schedule FROM pos_payment_plans WHERE id=${plan.id}`)[0]
          .due_schedule,
      ).toEqual(schedule);
    }
  });

  it('conserves signed ledger cents and rejects unsafe new or corrupt stored amounts', async () => {
    for (const amount of [1.005, -1.005])
      await addLedgerEntry(ctx, { client, kind: 'adjustment', amount, currency: 'PEN' });
    expect(await creditBalance(ctx, client)).toBe(0);
    expect((await listLedger(ctx, client)).map((row) => row.amount).sort()).toEqual([
      '-1.01',
      '1.01',
    ]);
    await expect(
      addLedgerEntry(ctx, { client, kind: 'topup', amount: 9999999999.995, currency: 'PEN' }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(
      addLedgerEntry(ctx, { client, kind: 'topup', amount: 1, currency: 'KWD' }),
    ).rejects.toMatchObject({ code: 'unsupported_pos_currency' });
    expect((await owner`SELECT count(*)::int AS n FROM pos_client_ledger`)[0].n).toBe(2);
    await owner`INSERT INTO pos_client_ledger (org_id,party_id,kind,amount,currency) VALUES (${ORG},${client.partyId},'adjustment','NaN','PEN')`;
    await expect(creditBalance(ctx, client)).rejects.toMatchObject({
      code: 'invalid_stored_amount',
    });
  });
});

function independentCtx(tenantId = ORG, profileId = ACTOR): CoreCtx {
  return {
    tenantId,
    profileId,
    db: drizzle(harness.createConnection(fixtureSchema), { schema: schemaTypes }),
  };
}

async function waitForAdvisoryWaiters(count: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows =
      await harness.owner`SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
    if (Number(rows[0].n) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${count} actual PostgreSQL advisory-lock waiters`);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function seedContactOnlyTicket(amount = '-30.00') {
  const shiftId = crypto.randomUUID();
  const ticketId = crypto.randomUUID();
  await owner`INSERT INTO pos_shifts (id,org_id,status,opened_by) VALUES (${shiftId},${ORG},'open',${ACTOR})`;
  await owner`INSERT INTO pos_tickets (
    id,org_id,human_id,shift_id,crm_contact_id,status,subtotal,total,currency,created_by
  ) VALUES (
    ${ticketId},${ORG},${`T-${ticketId.slice(0, 8)}`},${shiftId},${client.crmContactId},
    'submitted',30,30,'PEN',${ACTOR}
  )`;
  await owner`INSERT INTO pos_client_ledger (
    org_id,crm_contact_id,kind,amount,currency,ticket_id,created_by
  ) VALUES (${ORG},${client.crmContactId},'redemption',${amount},'PEN',${ticketId},${ACTOR})`;
  return { shiftId, ticketId };
}

describe('native wallet migration authority', () => {
  it('keeps the application ledger append-only under forced RLS and exposes only the versioned lock helper', async () => {
    const [role] = await owner<
      {
        owner: string;
        app_owner: boolean;
        inherit: boolean;
        superuser: boolean;
        bypassrls: boolean;
        select_insert: boolean;
        update_delete: boolean;
        execute_lock: boolean;
      }[]
    >`
      SELECT pg_get_userbyid(c.relowner) AS owner,
        pg_get_userbyid(c.relowner) = 'app_ledger' AS app_owner,
        r.rolinherit AS inherit, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
        has_table_privilege('app_ledger', ${`${fixtureSchema}.pos_client_ledger`}, 'SELECT,INSERT') AS select_insert,
        has_table_privilege('app_ledger', ${`${fixtureSchema}.pos_client_ledger`}, 'UPDATE,DELETE') AS update_delete,
        has_function_privilege('app_ledger', 'public.pos_advisory_key_v1(text,text,text,text)', 'EXECUTE') AS execute_lock
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN pg_roles r
      WHERE n.nspname=${fixtureSchema} AND c.relname='pos_client_ledger' AND r.rolname='app_ledger'
    `;
    expect(role).toMatchObject({
      owner: 'minion_qc',
      app_owner: false,
      inherit: false,
      superuser: false,
      bypassrls: false,
      select_insert: true,
      update_delete: false,
      execute_lock: true,
    });
    expect(
      await owner`SELECT public.pos_advisory_key_v1('wallet',${ORG},${CLIENT_KEY},'PEN') AS key`,
    ).toHaveLength(1);
    await expect(
      owner`SELECT public.pos_advisory_key_v1('unknown',${ORG},'','')`,
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      owner`SELECT public.pos_advisory_key_v1('settings','','','')`,
    ).rejects.toMatchObject({ code: '22023' });

    const inserted = await owner.begin(async (tx) => {
      await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${ORG},true)`;
      await tx`INSERT INTO pos_client_ledger (org_id,party_id,kind,amount,currency) VALUES (${ORG},${client.partyId},'topup',10,'PEN')`;
      return tx`SELECT amount::text AS amount FROM pos_client_ledger`;
    });
    expect(inserted).toEqual([{ amount: '10.00' }]);
    for (const statement of [
      'UPDATE pos_client_ledger SET amount=11',
      'DELETE FROM pos_client_ledger',
    ]) {
      await expect(
        owner.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${ORG},true)`;
          return tx.unsafe(statement);
        }),
      ).rejects.toMatchObject({ code: '42501' });
    }
    const foreign = await owner.begin(async (tx) => {
      await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${OTHER},true)`;
      return tx`SELECT * FROM pos_client_ledger`;
    });
    expect(foreign).toHaveLength(0);
    await expect(
      owner.begin(async (tx) => {
        await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${OTHER},true)`;
        return tx`INSERT INTO pos_client_ledger (org_id,party_id,kind,amount,currency) VALUES (${ORG},${client.partyId},'topup',10,'PEN')`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('isolates signed balances by currency and canonical party across contact aliases', async () => {
    await addLedgerEntry(ctx, { client, kind: 'topup', amount: 100, currency: 'PEN' });
    await addLedgerEntry(ctx, {
      client: { crmContactId: client.crmContactId },
      kind: 'topup',
      amount: 100,
      currency: 'USD',
    });
    await addLedgerEntry(ctx, {
      client: { partyId: client.partyId },
      kind: 'redemption',
      amount: -100,
      currency: 'PEN',
    });
    expect(await creditBalances(ctx, { crmContactId: client.crmContactId })).toEqual([
      { currency: 'PEN', balance: 0 },
      { currency: 'USD', balance: 100 },
    ]);
    expect(await creditBalance(ctx, client)).toBe(0);
    expect(
      await owner`SELECT currency, sum(amount)::text AS balance FROM pos_client_ledger GROUP BY currency ORDER BY currency`,
    ).toEqual([
      { currency: 'PEN', balance: '0.00' },
      { currency: 'USD', balance: '100.00' },
    ]);
  });

  it('serializes application and raw identity changes in both winner orders', async () => {
    const readerReady = deferred();
    const releaseReader = deferred();
    const oldIdentity = withOrgCore(independentCtx(), async (tx) => {
      await lockPosIdentityShared(tx, ORG);
      const identity = await resolveWalletIdentity(
        tx,
        ORG,
        { crmContactId: client.crmContactId },
        { lock: false },
      );
      readerReady.resolve();
      await releaseReader.promise;
      return identity;
    });
    await readerReady.promise;
    const appWriter = owner.begin(async (tx) => {
      await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${ORG},true)`;
      return tx`UPDATE crm_contacts SET party_id=${ALT_PARTY} WHERE id=${client.crmContactId}`;
    });
    await waitForAdvisoryWaiters(1);
    releaseReader.resolve();
    expect(await oldIdentity).toMatchObject({ clientKey: CLIENT_KEY });
    await appWriter;

    const writerReady = deferred();
    const releaseWriter = deferred();
    const ownerWriter = owner.begin(async (tx) => {
      await tx`UPDATE crm_contacts SET party_id=${client.partyId} WHERE id=${client.crmContactId}`;
      writerReady.resolve();
      await releaseWriter.promise;
    });
    await writerReady.promise;
    const currentIdentity = resolveWalletIdentityForAdmission(independentCtx(), {
      crmContactId: client.crmContactId,
    });
    await waitForAdvisoryWaiters(1);
    releaseWriter.resolve();
    await ownerWriter;
    expect(await currentIdentity).toMatchObject({ clientKey: CLIENT_KEY });
  });

  it('serializes a contact-only ticket void with a concurrent spend on the bridged party wallet', async () => {
    const { ticketId } = await seedContactOnlyTicket();
    const spendReady = deferred();
    const releaseSpend = deferred();
    const spend = withOrgCore(independentCtx(), async (tx) => {
      await lockPosIdentityShared(tx, ORG);
      const identity = await resolveWalletIdentity(tx, ORG, client, { lock: false });
      await lockPosWalletExclusive(tx, ORG, identity.clientKey, 'PEN');
      await addLedgerEntryInTx(
        tx,
        ORG,
        { client, kind: 'redemption', amount: -10, currency: 'PEN' },
        { identity, walletAlreadyLocked: true },
      );
      spendReady.resolve();
      await releaseSpend.promise;
    });
    await spendReady.promise;
    const voiding = voidTicket(independentCtx(), ticketId, { id: ACTOR, name: 'Fixture actor' });
    try {
      await waitForAdvisoryWaiters(1);
      releaseSpend.resolve();
      await spend;
      await expect(voiding).resolves.toMatchObject({ id: ticketId, status: 'void' });

      const rows = await owner<
        {
          party_id: string | null;
          crm_contact_id: string | null;
          amount: string;
          void_of: string | null;
        }[]
      >`SELECT party_id,crm_contact_id,amount::text AS amount,metadata->>'voidOf' AS void_of
        FROM pos_client_ledger ORDER BY created_at,id`;
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.party_id === null)).toHaveLength(2);
      expect(rows.filter((row) => row.party_id === client.partyId)).toHaveLength(1);
      expect(rows.find((row) => row.void_of)).toMatchObject({
        party_id: null,
        crm_contact_id: client.crmContactId,
        amount: '30.00',
      });
      expect(
        (await owner`SELECT sum(amount)::text AS balance FROM pos_client_ledger`)[0].balance,
      ).toBe('-10.00');
    } finally {
      releaseSpend.resolve();
      await Promise.allSettled([spend, voiding]);
    }
  });

  it('waits for a bridge winner then locks the contact-only refund under the newly active party', async () => {
    const { ticketId } = await seedContactOnlyTicket();
    const bridgeReady = deferred();
    const releaseBridge = deferred();
    const bridge = owner.begin(async (tx) => {
      await tx`UPDATE crm_contacts SET party_id=${ALT_PARTY} WHERE id=${client.crmContactId}`;
      bridgeReady.resolve();
      await releaseBridge.promise;
    });
    await bridgeReady.promise;

    const walletReady = deferred();
    const releaseWallet = deferred();
    const newOwnerWallet = withOrgCore(independentCtx(), async (tx) => {
      await lockPosWalletExclusive(tx, ORG, `party:${ALT_PARTY}`, 'PEN');
      walletReady.resolve();
      await releaseWallet.promise;
    });
    await walletReady.promise;

    const voiding = voidTicket(independentCtx(), ticketId, { id: ACTOR, name: 'Fixture actor' });
    try {
      await waitForAdvisoryWaiters(1);
      releaseBridge.resolve();
      await bridge;
      await waitForAdvisoryWaiters(1);
      releaseWallet.resolve();
      await newOwnerWallet;
      await expect(voiding).resolves.toMatchObject({ id: ticketId, status: 'void' });
      expect(
        await owner`SELECT party_id FROM crm_contacts WHERE id=${client.crmContactId}`,
      ).toEqual([{ party_id: ALT_PARTY }]);
      expect(
        await owner`SELECT party_id,crm_contact_id,amount::text AS amount
          FROM pos_client_ledger WHERE metadata ? 'voidOf'`,
      ).toEqual([{ party_id: null, crm_contact_id: client.crmContactId, amount: '30.00' }]);
    } finally {
      releaseBridge.resolve();
      releaseWallet.resolve();
      await Promise.allSettled([bridge, newOwnerWallet, voiding]);
    }
  });

  it('serializes settings writes and makes post-wait readers observe the committed policy revision', async () => {
    const readerReady = deferred();
    const releaseReader = deferred();
    const original = withOrgCore(independentCtx(), async (tx) => {
      const settings = await getPosSettingsInTx(tx, ORG);
      readerReady.resolve();
      await releaseReader.promise;
      return settings;
    });
    await readerReady.promise;
    const appInsert = owner.begin(async (tx) => {
      await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${ORG},true)`;
      return tx`INSERT INTO pos_settings (org_id,currency) VALUES (${ORG},'USD')`;
    });
    await waitForAdvisoryWaiters(1);
    releaseReader.resolve();
    const originalSettings = await original;
    await appInsert;
    expect(originalSettings.currency).toBe('PEN');
    const insertedSettings = await withOrgCore(independentCtx(), (tx) =>
      getPosSettingsInTx(tx, ORG),
    );
    expect(insertedSettings.currency).toBe('USD');
    expect(insertedSettings.paymentPolicyRevision).not.toBe(originalSettings.paymentPolicyRevision);

    const writerReady = deferred();
    const releaseWriter = deferred();
    const ownerUpdate = owner.begin(async (tx) => {
      await tx`UPDATE pos_settings SET currency='PEN' WHERE org_id=${ORG}`;
      writerReady.resolve();
      await releaseWriter.promise;
    });
    await writerReady.promise;
    const postWait = withOrgCore(independentCtx(), (tx) => getPosSettingsInTx(tx, ORG));
    await waitForAdvisoryWaiters(1);
    releaseWriter.resolve();
    await ownerUpdate;
    const current = await postWait;
    expect(current.currency).toBe('PEN');
    expect(current.paymentPolicyRevision).not.toBe(insertedSettings.paymentPolicyRevision);
  });

  it('fences grant and source-ticket mutations in both winner orders with fresh trigger validation', async () => {
    const ticketId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    await owner`INSERT INTO pos_tickets (id,org_id,status,currency) VALUES (${ticketId},${ORG},'submitted','PEN')`;
    await owner`INSERT INTO pos_ticket_lines (id,org_id,ticket_id,total) VALUES (${lineId},${ORG},${ticketId},100)`;
    const grantInput = {
      client,
      line: {
        ticketId,
        lineId,
        packageProductId: '30000000-0000-4000-8000-000000000001',
        qty: 1,
        total: 100,
      },
      edges: [{ childProductId: '30000000-0000-4000-8000-000000000002', qty: 2 }],
    };

    const grantReady = deferred();
    const releaseGrant = deferred();
    const grantWinner = withOrgCore(independentCtx(), async (tx) => {
      await lockGrantSources(tx, ORG, [ticketId]);
      const rows = await createGrantsForTicketLine(tx, ORG, grantInput);
      grantReady.resolve();
      await releaseGrant.promise;
      return rows;
    });
    await grantReady.promise;
    await expect(
      owner`UPDATE pos_tickets SET currency='USD' WHERE id=${ticketId}`,
    ).rejects.toMatchObject({ code: '40001' });
    releaseGrant.resolve();
    expect(await grantWinner).toHaveLength(1);
    await owner`DELETE FROM pos_package_grants`;

    const sourceReady = deferred();
    const releaseSource = deferred();
    const sourceWinner = owner.begin(async (tx) => {
      await tx`UPDATE pos_tickets SET currency='KWD' WHERE id=${ticketId}`;
      sourceReady.resolve();
      await releaseSource.promise;
    });
    await sourceReady.promise;
    const losingGrant = withOrgCore(independentCtx(), (tx) =>
      createGrantsForTicketLine(tx, ORG, grantInput),
    );
    await waitForAdvisoryWaiters(1);
    releaseSource.resolve();
    await sourceWinner;
    await expect(losingGrant).rejects.toMatchObject({ code: 'unsupported_pos_currency' });

    await owner`UPDATE pos_tickets SET currency='PEN' WHERE id=${ticketId}`;
    const pauseKey = BigInt(`0x${crypto.randomUUID().replaceAll('-', '').slice(0, 15)}`).toString();
    await owner.unsafe(`
      CREATE FUNCTION pos_test_pause_ticket_update() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$
      BEGIN
        PERFORM pg_catalog.pg_advisory_xact_lock(${pauseKey}::bigint);
        RETURN NULL;
      END;
      $$;
      CREATE TRIGGER pos_test_pause_ticket_update
      BEFORE UPDATE ON pos_tickets FOR EACH STATEMENT
      EXECUTE FUNCTION pos_test_pause_ticket_update();
    `);
    const commitGrant = deferred();
    const competingOwner = harness.createConnection(fixtureSchema);
    const stagedGrant = owner.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${pauseKey}::bigint)`;
      await tx`INSERT INTO pos_package_grants (
        org_id,party_id,crm_contact_id,source_ticket_id,source_line_id,
        package_product_id,service_product_id,sessions_total,unit_value
      ) VALUES (
        ${ORG},${client.partyId},${client.crmContactId},${ticketId},${lineId},
        ${grantInput.line.packageProductId},${grantInput.edges[0].childProductId},2,50
      )`;
      await commitGrant.promise;
    });
    try {
      const staleStatement = Promise.resolve(
        competingOwner`UPDATE pos_tickets SET currency='USD' WHERE id=${ticketId}`,
      );
      await waitForAdvisoryWaiters(1);
      commitGrant.resolve();
      await stagedGrant;
      await expect(staleStatement).rejects.toMatchObject({ code: '23503' });
      expect(await owner`SELECT currency FROM pos_tickets WHERE id=${ticketId}`).toEqual([
        { currency: 'PEN' },
      ]);
    } finally {
      commitGrant.resolve();
      await stagedGrant.catch(() => undefined);
      await owner.unsafe(`
        DROP TRIGGER IF EXISTS pos_test_pause_ticket_update ON pos_tickets;
        DROP FUNCTION IF EXISTS pos_test_pause_ticket_update();
      `);
    }
  });

  it('rejects a relink after preflight with no operation row and replays an immutable legacy receipt', async () => {
    const prepared = await resolveWalletIdentityForAdmission(ctx, client);
    expect(prepared.clientKey).toBe(CLIENT_KEY);
    await owner`UPDATE crm_contacts SET party_id=${ALT_PARTY} WHERE id=${client.crmContactId}`;
    const rejectedId = crypto.randomUUID();
    await expect(
      createPlan(ctx, input({ operationId: rejectedId, clientKey: prepared.clientKey })),
    ).rejects.toMatchObject({ code: 'wallet_identity_changed' });
    expect(await lookupOwnPlanOperation(ctx, rejectedId)).toBeNull();
    expect(await planCount()).toBe(0);

    await owner`UPDATE crm_contacts SET party_id=${client.partyId} WHERE id=${client.crmContactId}`;
    const legacy = await createPlan(ctx, input());
    const legacyId = crypto.randomUUID();
    const legacyRequest = input({ operationId: legacyId, clientKey: undefined });
    const total = moneyNumber(legacyRequest.totalAmount, { numeric12: true });
    const operationHash = planRequestHash(legacyRequest, {
      total,
      dueSchedule: validateDueSchedule(legacyRequest.dueSchedule, total),
    });
    await owner`UPDATE pos_payment_plans SET operation_id=${legacyId},operation_hash=${operationHash},created_by=${ACTOR} WHERE id=${legacy.id}`;
    await owner`DELETE FROM parties WHERE id=${client.partyId}`;
    await owner`INSERT INTO pos_settings (org_id,currency) VALUES (${ORG},'JPY')`;
    expect(await createPlan(ctx, legacyRequest)).toMatchObject({ id: legacy.id, currency: 'PEN' });
    expect(await lookupOwnPlanOperation(ctx, legacyId)).toEqual({
      id: legacy.id,
      clientKey: CLIENT_KEY,
      identityVersion: 1,
    });
    expect(await planCount()).toBe(1);
  });
});

async function orderedRace(
  operationId: string,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  let release!: () => void;
  let locked!: () => void;
  const lockReady = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const releaseLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['pos-plan-operation-v1', ORG, operationId])}, 0))`;
    locked();
    await releaseLock;
  });
  await lockReady;
  const outcomes: Promise<PromiseSettledResult<unknown>[]>[] = [];
  try {
    outcomes.push(Promise.allSettled([first()]));
    await waitForAdvisoryWaiters(1);
    outcomes.push(Promise.allSettled([second()]));
    await waitForAdvisoryWaiters(2);
  } finally {
    release();
    await blocker;
  }
  return (await Promise.all(outcomes)).flat();
}

describe('native plan operation admission', () => {
  it('keeps identical requests with distinct operation IDs independent and ignores caller actor overrides', async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const request = input({
      clientKey: CLIENT_KEY,
      actor: { id: OTHER_ACTOR, name: 'Untrusted presentation actor' },
    });
    const first = await createPlan(ctx, { ...request, operationId: firstId });
    const second = await createPlan(ctx, { ...request, operationId: secondId });
    expect(first.id).not.toBe(second.id);
    expect(first.createdBy).toBe(ACTOR);
    expect(second.createdBy).toBe(ACTOR);
    expect(await lookupOwnPlanOperation(ctx, firstId)).toEqual({
      id: first.id,
      clientKey: CLIENT_KEY,
      identityVersion: 2,
    });
    expect(await lookupOwnPlanOperation(ctx, secondId)).toEqual({
      id: second.id,
      clientKey: CLIENT_KEY,
      identityVersion: 2,
    });
    expect(await planCount()).toBe(2);
  });
  it('converges concurrent same-key creates and never exposes request identity in plan DTOs', async () => {
    const operationId = crypto.randomUUID();
    const request = input({ operationId, bookingId: BOOKING });
    const [a, b] = await orderedRace(
      operationId,
      () => createPlan(independentCtx(), request),
      () => createPlan(independentCtx(), request),
    );
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    if (a.status !== 'fulfilled' || b.status !== 'fulfilled')
      throw new Error('Both creates must converge');
    expect(a.value).toEqual(b.value);
    expect(await planCount()).toBe(1);
    const receipt = await lookupOwnPlanOperation(ctx, operationId);
    expect(receipt).toEqual({
      id: (a.value as { id: string }).id,
      clientKey: CLIENT_KEY,
      identityVersion: 2,
    });
    const listed = await listPlans(ctx);
    const detail = await getPlan(ctx, receipt!.id);
    for (const projection of [
      a.value,
      b.value,
      ...listed,
      detail,
      await cancelPlan(ctx, receipt!.id),
    ]) {
      expect(projection).not.toHaveProperty('operationId');
      expect(projection).not.toHaveProperty('operationHash');
      expect(projection).not.toHaveProperty('operationVersion');
      expect(projection).not.toHaveProperty('operationClientKey');
    }
    expect(
      (await owner`SELECT payment_plan_id FROM sched_bookings WHERE id=${BOOKING}`)[0]
        .payment_plan_id,
    ).toBe(receipt!.id);
  });

  it('settles a keyed plan without exposing request identity through its nested detail projection', async () => {
    const operationId = crypto.randomUUID();
    const plan = await createPlan(ctx, input({ operationId }));
    await paid(plan.id, '100.00');
    const detail = await settlePlanIfPaid(ctx, plan.id);
    expect(detail).toMatchObject({ isPaid: true, remaining: 0, plan: { status: 'settled' } });
    expect(detail.plan).not.toHaveProperty('operationId');
    expect(detail.plan).not.toHaveProperty('operationHash');
    expect(
      await owner`SELECT operation_id, operation_hash, status FROM pos_payment_plans WHERE id=${plan.id}`,
    ).toEqual([
      {
        operation_id: operationId,
        operation_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        status: 'settled',
      },
    ]);
  });

  it('replays the original version-2 plan after cancellation, relink and settings change', async () => {
    const operationId = crypto.randomUUID();
    await owner`INSERT INTO pos_settings (org_id,currency) VALUES (${ORG},'USD')`;
    const request = input({ operationId, currency: undefined });
    const plan = await createPlan(ctx, request);
    expect(plan.currency).toBe('USD');
    await cancelPlan(ctx, plan.id);
    await owner`UPDATE crm_contacts SET party_id=${ALT_PARTY} WHERE id=${client.crmContactId}`;
    await owner`UPDATE pos_settings SET currency='JPY' WHERE org_id=${ORG}`;
    expect(await createPlan(ctx, request)).toMatchObject({
      id: plan.id,
      currency: 'USD',
      status: 'cancelled',
    });
    expect(await planCount()).toBe(1);
  });

  it('rejects changed intent and another actor while allowing the same key in another organization', async () => {
    const operationId = crypto.randomUUID();
    const request = input({ operationId });
    const plan = await createPlan(ctx, request);
    for (const patch of [
      { totalAmount: 101 },
      { note: 'changed' },
      { title: 'Other' },
      { currency: 'USD' },
      { client: { partyId: crypto.randomUUID() } },
    ]) {
      await expect(createPlan(ctx, { ...request, ...patch })).rejects.toMatchObject({
        code: 'operation_conflict',
      });
    }
    const stranger = independentCtx(ORG, OTHER_ACTOR);
    await expect(createPlan(stranger, request)).rejects.toMatchObject({
      code: 'operation_conflict',
    });
    await expect(cancelPlanOperation(stranger, operationId)).rejects.toMatchObject({
      code: 'operation_conflict',
    });
    expect(await lookupOwnPlanOperation(stranger, operationId)).toBeNull();
    expect(await lookupOwnPlanOperation(independentCtx(OTHER), operationId)).toBeNull();
    const other = await createPlan(independentCtx(OTHER), {
      ...request,
      client: { partyId: OTHER_PARTY, crmContactId: OTHER_CONTACT },
      clientKey: `party:${OTHER_PARTY}`,
    });
    expect(other.id).not.toBe(plan.id);
    expect(await planCount()).toBe(2);
  });

  it('leaves no receipt after booking-link rollback and permits a later valid retry with that key', async () => {
    const operationId = crypto.randomUUID();
    const request = input({ operationId, bookingId: FOREIGN_BOOKING });
    await expect(createPlan(ctx, request)).rejects.toMatchObject({ code: 'not_found' });
    expect(await lookupOwnPlanOperation(ctx, operationId)).toBeNull();
    expect(await planCount()).toBe(0);
    await owner`UPDATE sched_bookings SET org_id=${ORG} WHERE id=${FOREIGN_BOOKING}`;
    const plan = await createPlan(ctx, request);
    expect(await lookupOwnPlanOperation(ctx, operationId)).toEqual({
      id: plan.id,
      clientKey: CLIENT_KEY,
      identityVersion: 2,
    });
  });

  it('cancellation wins its lock order and fences every delayed create without cancelling other plans', async () => {
    const operationId = crypto.randomUUID();
    const [cancelled, create] = await orderedRace(
      operationId,
      () => cancelPlanOperation(independentCtx(), operationId),
      () => createPlan(independentCtx(), input({ operationId })),
    );
    expect(cancelled).toEqual({ status: 'fulfilled', value: { status: 'cancelled' } });
    expect(create).toMatchObject({ status: 'rejected', reason: { code: 'operation_cancelled' } });
    expect(await cancelPlanOperation(ctx, operationId)).toEqual({ status: 'cancelled' });
    await expect(createPlan(ctx, input({ operationId }))).rejects.toMatchObject({
      code: 'operation_cancelled',
    });
    await expect(
      cancelPlanOperation(independentCtx(ORG, OTHER_ACTOR), operationId),
    ).rejects.toMatchObject({ code: 'operation_conflict' });
    await expect(
      createPlan(independentCtx(ORG, OTHER_ACTOR), input({ operationId })),
    ).rejects.toMatchObject({ code: 'operation_conflict' });
    expect(await planCount()).toBe(0);
  });

  it('create wins its lock order and cancellation returns the committed receipt without changing agreement state', async () => {
    const operationId = crypto.randomUUID();
    const [create, cancelled] = await orderedRace(
      operationId,
      () => createPlan(independentCtx(), input({ operationId })),
      () => cancelPlanOperation(independentCtx(), operationId),
    );
    expect(create.status).toBe('fulfilled');
    if (create.status !== 'fulfilled') throw new Error('Create must commit');
    const id = (create.value as { id: string }).id;
    expect(cancelled).toEqual({
      status: 'fulfilled',
      value: { status: 'committed', plan: { id } },
    });
    expect((await owner`SELECT status FROM pos_payment_plans WHERE id=${id}`)[0].status).toBe(
      'open',
    );
    expect((await owner`SELECT count(*) AS n FROM pos_plan_operation_cancellations`)[0].n).toBe(
      '0',
    );
  });

  it('enforces paired key hash actor constraints and per-organization uniqueness in production DDL', async () => {
    const operationId = crypto.randomUUID();
    const plan = await createPlan(ctx, input({ operationId }));
    for (const mutation of [
      `UPDATE pos_payment_plans SET operation_hash=NULL WHERE id='${plan.id}'`,
      `UPDATE pos_payment_plans SET operation_id=NULL WHERE id='${plan.id}'`,
      `UPDATE pos_payment_plans SET operation_hash='invalid' WHERE id='${plan.id}'`,
      `UPDATE pos_payment_plans SET created_by=NULL WHERE id='${plan.id}'`,
    ])
      await expect(owner.unsafe(mutation)).rejects.toMatchObject({ code: '23514' });
    const legacy = await createPlan(ctx, input());
    await expect(
      owner`UPDATE pos_payment_plans SET operation_id=${operationId},operation_hash=${'a'.repeat(64)},created_by=${ACTOR} WHERE id=${legacy.id}`,
    ).rejects.toMatchObject({ code: '23505' });
    expect(await planCount()).toBe(2);
  });

  it('denies browser tombstone access and tenant update delete or cross-organization insert under forced RLS', async () => {
    const operationId = crypto.randomUUID();
    await cancelPlanOperation(ctx, operationId);
    const privileges =
      await owner`SELECT rolname, has_table_privilege(rolname, ${`${fixtureSchema}.pos_plan_operation_cancellations`}, 'SELECT') AS read, has_table_privilege(rolname, ${`${fixtureSchema}.pos_plan_operation_cancellations`}, 'INSERT') AS write, has_table_privilege(rolname, ${`${fixtureSchema}.pos_plan_operation_cancellations`}, 'UPDATE,DELETE,TRUNCATE') AS mutate FROM pg_roles WHERE rolname IN ('anon','authenticated','app_ledger') ORDER BY rolname`;
    expect(privileges).toEqual([
      { rolname: 'anon', read: false, write: false, mutate: false },
      { rolname: 'app_ledger', read: true, write: true, mutate: false },
      { rolname: 'authenticated', read: false, write: false, mutate: false },
    ]);
    for (const query of [
      `UPDATE pos_plan_operation_cancellations SET created_by='${OTHER_ACTOR}'`,
      'DELETE FROM pos_plan_operation_cancellations',
      `INSERT INTO pos_plan_operation_cancellations VALUES ('${OTHER}','${crypto.randomUUID()}','${ACTOR}',now())`,
    ])
      await expect(
        owner.begin(async (tx) => {
          await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${ORG},true)`;
          return tx.unsafe(query);
        }),
      ).rejects.toMatchObject({ code: '42501' });
    const foreignRows = await owner.begin(async (tx) => {
      await tx`SELECT set_config('role','app_ledger',true),set_config('app.current_org_id',${OTHER},true)`;
      return tx`SELECT * FROM pos_plan_operation_cancellations`;
    });
    expect(foreignRows).toHaveLength(0);
    expect((await owner`SELECT count(*) AS n FROM pos_plan_operation_cancellations`)[0].n).toBe(
      '1',
    );
  });

  it('requires a canonical authenticated actor for keyed operations while preserving legacy creation', async () => {
    const operationId = crypto.randomUUID();
    const anonymous = { ...ctx, profileId: undefined };
    await expect(createPlan(anonymous, input({ operationId }))).rejects.toMatchObject({
      code: 'operation_actor_required',
    });
    await expect(lookupOwnPlanOperation(anonymous, operationId)).rejects.toMatchObject({
      code: 'operation_actor_required',
    });
    await expect(cancelPlanOperation(anonymous, operationId)).rejects.toMatchObject({
      code: 'operation_actor_required',
    });
    expect(await planCount()).toBe(0);
    expect(await createPlan(anonymous, input())).toMatchObject({ createdBy: null });
  });
});
