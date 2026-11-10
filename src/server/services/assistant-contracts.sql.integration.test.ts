import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { withOrgCore } from '$server/db/with-org-core';
import {
  schedBookings,
  schedBookingStatusLog,
  schedEventTypes,
  schedEventTypeResources,
  schedResources,
  schedSchedules,
  schedAvailability,
} from '$server/db/pg-scheduling-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import { hrEmployees, hrHolidays, hrLeaveRequests, hrSettings } from '$server/db/pg-hr-schema';
import { finInvoices, finInvoiceItems, finProducts } from '$server/db/pg-finance-schema';
import { posSettings } from '$server/db/pg-pos-schema';

// Only configuration and unrelated external effect adapters are synthetic.
// withOrgCore, scheduling/availability, finance SQL, postgres-js and RLS execute.
vi.mock('./finance.service', () => ({
  getFinSettings: async () => ({ timezone: 'America/Lima' }),
}));
vi.mock('$server/events/emit', () => ({ emitHubEvent: vi.fn() }));
vi.mock('./tag-links.service', () => ({ getTagLinks: vi.fn(), getContactTagsBulk: vi.fn() }));
vi.mock('./custom-properties.service', () => ({ putCustomPropertyValueInTx: vi.fn() }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: vi.fn(),
  accrualSummaryForSources: vi.fn(),
  releaseAccruals: vi.fn(),
}));
vi.mock('./activity.service', () => ({ recordAuditInTx: vi.fn() }));
vi.mock('./pos-packages.service', () => ({
  getGrant: vi.fn(),
  redeemSessionInTx: vi.fn(),
  reverseRedemptionInTx: vi.fn(),
}));
vi.mock('./pos-accounts.service', () => ({ getPlan: vi.fn() }));
vi.mock('./crm-contact-ensure', () => ({ ensureCrmContact: vi.fn() }));
vi.mock('./pos-accounts.logic', () => ({ grantToday: vi.fn() }));
import { assistantProductRanking } from './assistant-product-ranking.service';
import { assistantBookingOptions } from './assistant-booking-options.service';
import {
  previewAssistantReschedule,
  queryAssistantBookings,
  rescheduleAssistantBooking,
  SlotUnavailableError,
  BookingConflictError,
} from './scheduling-bookings.service';

const databaseUrl = testDatabaseUrl();
if (process.env.REQUIRE_ASSISTANT_CONTRACTS_POSTGRES && !databaseUrl)
  throw new Error('REQUIRE_ASSISTANT_CONTRACTS_POSTGRES requires explicit HUB_TEST_DB_URL');
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.port)
    throw new Error('Assistant native qualification requires an explicit loopback PostgreSQL port');
}
const schema = `assistant_contracts_${randomUUID().replaceAll('-', '')}`;
const application = `assistant-native-${randomUUID()}`;
const owner = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} })
  : null;
const app = databaseUrl
  ? postgres(databaseUrl, {
      max: 4,
      prepare: false,
      onnotice: () => {},
      connection: { search_path: `${schema},pg_catalog`, application_name: application },
    })
  : null;
const db = app ? drizzle(app) : null;
const blocker = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} })
  : null;
const org = 'fixture-org';
const foreignOrg = 'foreign-fixture-org';
const profile = '10000000-0000-4000-8000-000000000001';
const resource = '20000000-0000-4000-8000-000000000001';
const otherResource = '20000000-0000-4000-8000-000000000002';
const inactiveResource = '20000000-0000-4000-8000-000000000003';
const eventType = '30000000-0000-4000-8000-000000000001';
const foreignEventType = '30000000-0000-4000-8000-000000000002';
const contact = '40000000-0000-4000-8000-000000000001';
const foreignContact = '40000000-0000-4000-8000-000000000002';
const schedule = '50000000-0000-4000-8000-000000000001';
const booking = '60000000-0000-4000-8000-000000000001';
const product = '70000000-0000-4000-8000-000000000001';
const oldStart = new Date('2030-01-07T15:00:00Z');
const start = new Date('2030-01-07T15:30:00Z');
const ctx = { db: db as unknown as CoreCtx['db'], tenantId: org, profileId: profile };
const tables = [
  schedBookings,
  schedBookingStatusLog,
  schedEventTypes,
  schedEventTypeResources,
  schedResources,
  schedSchedules,
  schedAvailability,
  crmContacts,
  hrEmployees,
  hrHolidays,
  hrLeaveRequests,
  hrSettings,
  finInvoices,
  finInvoiceItems,
  finProducts,
  posSettings,
];
let created = false;

async function seedBooking(id = booking, overrides: Record<string, unknown> = {}) {
  const row = {
    org,
    contact,
    resource,
    status: 'accepted',
    start: oldStart,
    end: new Date(oldStart.getTime() + 60 * 60_000),
    metadata: { fixtureLink: 'preserved', ticketId: 'linked-ticket', packageId: 'linked-package' },
    ...overrides,
  };
  await app!`insert into sched_bookings(id,org_id,uid,event_type_id,resource_id,crm_contact_id,
    start_time,end_time,status,attendee_name,attendee_email,attendee_phone,notes,metadata,
    package_grant_id,payment_plan_id,series_id,series_index,created_at,updated_at)
    values(${id},${row.org},${id},${eventType},${row.resource},${row.contact},
      ${(row.start as Date).toISOString()},${(row.end as Date).toISOString()},${row.status},'Fixture attendee','fixture@example.invalid',
      '+15550000000','preserved note',${JSON.stringify(row.metadata)}::jsonb,
      '80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003',3,
      '2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')`;
}
async function storedBooking(id = booking) {
  const row = (await app!`select * from sched_bookings where id=${id}`)[0];
  return {
    ...row,
    start_time: new Date(row.start_time),
    end_time: new Date(row.end_time),
    updated_at: new Date(row.updated_at),
    metadata: row.metadata as Record<string, unknown> | null,
    package_grant_id: row.package_grant_id as string | null,
    payment_plan_id: row.payment_plan_id as string | null,
    series_id: row.series_id as string | null,
  };
}
async function waitForBlockedWriters() {
  for (let attempt = 0; attempt < 150; attempt++) {
    const [row] = await owner!`select count(*)::int count from pg_stat_activity
      where application_name=${application} and wait_event_type='Lock'`;
    if (Number(row.count) >= 2) return;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error('Both assistant writers did not reach the controlled PostgreSQL lock boundary');
}
function errorCode(error: unknown): string | undefined {
  for (let depth = 0; error && depth < 5; depth++) {
    if (typeof error !== 'object') return undefined;
    const candidate = error as { code?: string; cause?: unknown };
    if (candidate.code) return candidate.code;
    error = candidate.cause;
  }
}

describe.skipIf(!databaseUrl)('assistant contracts against native PostgreSQL role and RLS', () => {
  beforeAll(async () => {
    await owner!
      .unsafe(`do $$ begin create role app_ledger nologin noinherit nosuperuser nobypassrls;
      exception when duplicate_object then null; end $$`);
    const [role] =
      await owner!`select rolsuper,rolbypassrls from pg_roles where rolname='app_ledger'`;
    if (role.rolsuper || role.rolbypassrls)
      throw new Error('Fixture app_ledger must not bypass RLS');
    await owner!.unsafe(`create schema "${schema}"`);
    created = true;
    await owner!.unsafe(`grant usage on schema "${schema}" to app_ledger`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => `"${column.name}" ${column.getSQLType()}`);
      // The projection uses actual declared column types. This is a minimal
      // isolated schema, not a migration/deployed-catalog qualification.
      await owner!.unsafe(`create table "${schema}"."${config.name}" (${columns.join(',')})`);
      await owner!
        .unsafe(`grant select,insert,update,delete on "${schema}"."${config.name}" to app_ledger;
        alter table "${schema}"."${config.name}" enable row level security;
        alter table "${schema}"."${config.name}" force row level security;
        create policy fixture_org_guc on "${schema}"."${config.name}" for all to app_ledger
          using(org_id::text=current_setting('app.current_org_id',true))
          with check(org_id::text=current_setting('app.current_org_id',true))`);
    }
  });
  beforeEach(async () => {
    await app!.unsafe(
      'truncate ' + tables.map((table) => '"' + getTableConfig(table).name + '"').join(','),
    );
    await app!`insert into sched_resources(id,org_id,name,email,timezone,active,created_at)
      values(${resource},${org},'Fixture staff','resource-private@example.invalid','America/Lima',true,now()),
      (${otherResource},${foreignOrg},'Foreign staff','foreign-private@example.invalid','America/Lima',true,now()),
      (${inactiveResource},${org},'Inactive staff',null,'America/Lima',false,now())`;
    await app!`insert into fin_products(id,org_id,code,name,unit_price,active)
      values(${product},${org},'FIXTURE','Fixture product',100,true)`;
    await app!`insert into sched_event_types(id,org_id,title,active,length,slot_interval,before_buffer,after_buffer,
      minimum_booking_notice,period_type,requires_confirmation,product_id)
      values(${eventType},${org},'Fixture service',true,60,15,0,0,0,'unlimited',false,${product}),
      (${foreignEventType},${foreignOrg},'Foreign service',true,60,15,0,0,0,'unlimited',false,null)`;
    await app!`insert into sched_event_type_resources(org_id,event_type_id,resource_id)
      values(${org},${eventType},${resource}),(${org},${eventType},${inactiveResource}),
      (${foreignOrg},${foreignEventType},${otherResource})`;
    await app!`insert into sched_schedules(id,org_id,resource_id,timezone,created_at)
      values(${schedule},${org},${resource},'America/Lima',now())`;
    await app!`insert into sched_availability(org_id,schedule_id,days,start_time,end_time)
      values(${org},${schedule},array[1,2,3,4,5],'08:00','18:00')`;
    await app!`insert into crm_contacts(id,org_id,display_name)
      values(${contact},${org},'Fixture customer'),(${foreignContact},${foreignOrg},'Foreign customer')`;
    await app!`insert into pos_settings(org_id,currency) values(${org},'PEN')`;
  });
  afterAll(async () => {
    await Promise.all([app?.end({ timeout: 5 }), blocker?.end({ timeout: 5 })]);
    try {
      if (created) await owner!.unsafe(`drop schema "${schema}" cascade`);
    } finally {
      await owner?.end({ timeout: 5 });
    }
  });

  it('uses the nonbypass app_ledger role and actor GUC then resets pooled scope', async () => {
    const receipt = await withOrgCore(ctx, async (tx) => {
      const [scope] = await tx.execute(sql`select current_user as role,
        current_setting('app.current_org_id') as org,
        current_setting('app.current_profile_id') as profile,
        row_security_active('sched_resources') as rls`);
      // Deliberately no org predicate: the database policy must hide the foreign row.
      const resources = await tx.execute(sql`select id from sched_resources order by id`);
      return { scope, resources };
    });
    expect(receipt.scope).toMatchObject({ role: 'app_ledger', org, profile, rls: true });
    expect(receipt.resources.map((row) => row.id)).toEqual([resource, inactiveResource]);
    const [scope] =
      await app!`select current_user as role,current_setting('app.current_org_id',true) as org,
        current_setting('app.current_profile_id',true) as profile`;
    expect(scope.role).toBe('postgres');
    expect(scope.org ?? '').toBe('');
    expect(scope.profile ?? '').toBe('');
  });

  it('denies a cross-org write with native RLS and keeps independent org reads isolated', async () => {
    const denied = await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
      insert into sched_resources(id,org_id,name) values(${randomUUID()},${foreignOrg},'Rejected')
    `),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(errorCode(denied)).toBe('42501');
    const other = { ...ctx, tenantId: foreignOrg };
    const [ownRows, otherRows] = await Promise.all([
      withOrgCore(ctx, (tx) => tx.execute(sql`select id from sched_resources`)),
      withOrgCore(other, (tx) => tx.execute(sql`select id from sched_resources`)),
    ]);
    expect(ownRows.map((row) => row.id)).not.toContain(otherResource);
    expect(otherRows.map((row) => row.id)).toEqual([otherResource]);
  });

  it('ranks the full scoped quantity population and separates money currencies under native RLS', async () => {
    const invoice = randomUUID();
    const winner = randomUUID();
    const loser = randomUUID();
    await app!`insert into fin_invoices(id,org_id,currency,status,shadowed,issued_at)
      values(${invoice},${org},'PEN','paid',false,'2030-01-07T00:00:00Z')`;
    await app!`insert into fin_invoice_items(id,org_id,invoice_id,product_id,code,description,quantity,total)
      values(${winner},${org},${invoice},null,'VOLUME','Quantity winner',100,10),
      (${loser},${org},${invoice},null,'REVENUE','Revenue winner',1,10000),
      (${randomUUID()},${foreignOrg},${invoice},null,'POISON','Foreign child must be hidden',99999,99999),
      (${randomUUID()},${org},${invoice},null,'   ','Unidentified row',1000,1000)`;
    const quantity = await assistantProductRanking(
      ctx,
      { bucket: 'month', from: null, to: null },
      { metric: 'quantity', limit: 1 },
    );
    expect(quantity.groups[0].rows[0]).toMatchObject({ code: 'VOLUME', value: 100 });
    expect(quantity.groups[0]).toMatchObject({ total: 2, returned: 1, truncated: true });
    expect(quantity.unidentifiedLineCount).toBe(1);
    const second = randomUUID();
    await app!`insert into fin_invoices(id,org_id,currency,status,shadowed,issued_at)
      values(${second},${org},'USD','paid',false,'2030-01-07T00:00:00Z')`;
    await app!`insert into fin_invoice_items(id,org_id,invoice_id,code,description,quantity,total)
      values(${randomUUID()},${org},${second},'USD','Dollar item',1,20)`;
    const revenue = await assistantProductRanking(
      ctx,
      { bucket: 'month', from: null, to: null },
      { metric: 'revenue', limit: 1 },
    );
    expect(revenue.groups.map((group) => group.currency)).toEqual(['PEN', 'USD']);
    expect(revenue.groups.map((group) => group.rows[0].value)).toEqual([10000, 20]);
  });

  it('returns full booking status aggregates despite row caps and masks attendee PII', async () => {
    const statuses = [
      'no_show',
      'no_show',
      'no_show',
      'no_show',
      'completed',
      'completed',
      'completed',
      'pending',
      'pending',
      'accepted',
      'cancelled',
    ];
    for (const status of statuses) await seedBooking(randomUUID(), { status });
    await seedBooking(randomUUID(), { org: foreignOrg });
    const list = await queryAssistantBookings(ctx, { limit: 3, maskAttendeePii: true });
    expect(list).toMatchObject({
      total: 11,
      returned: 3,
      truncated: true,
      statusCounts: { no_show: 4, completed: 3, pending: 2, accepted: 1, cancelled: 1 },
      summary: { snapshot: 'same_statement', people: 'not_computed' },
    });
    expect(list.bookings.every((row) => row.attendeeEmail !== 'fixture@example.invalid')).toBe(
      true,
    );
    const count = await queryAssistantBookings(ctx, { countOnly: true });
    expect(count.total).toBe(11);
    expect(count.statusCounts).toEqual(list.statusCounts);
  });

  it('discovers active scoped references and real local-day slots without resource PII', async () => {
    const options = await assistantBookingOptions(ctx, {
      eventTypeId: eventType,
      date: '2030-01-07',
      limit: 100,
    });
    expect(options.eventTypes).toEqual([
      expect.objectContaining({
        eventTypeId: eventType,
        productId: product,
        resourceIds: [resource],
      }),
    ]);
    expect(options.resources).toEqual([
      { resourceId: resource, name: 'Fixture staff', timezone: 'America/Lima' },
    ]);
    expect(options.slots.length).toBeGreaterThan(0);
    expect(options.slots.every((slot) => slot.resourceIds.every((id) => id === resource))).toBe(
      true,
    );
    expect(JSON.stringify(options)).not.toContain('private@example.invalid');
    expect(options.availability).toBe('at_read_not_reserved');
    await expect(
      assistantBookingOptions(ctx, { eventTypeId: foreignEventType, limit: 10 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('applies native holiday rules to availability and assistant moves', async () => {
    await seedBooking();
    await app!`insert into hr_holidays(org_id,date,name,enabled) values(${org},'2030-01-08','Fixture holiday',true)`;
    const options = await assistantBookingOptions(ctx, {
      eventTypeId: eventType,
      date: '2030-01-08',
      limit: 100,
    });
    expect(options.slots).toEqual([]);
    await expect(
      previewAssistantReschedule(ctx, booking, { start: new Date('2030-01-08T15:00:00Z') }),
    ).rejects.toThrow();
    expect((await storedBooking()).start_time).toEqual(oldStart);
  });

  it('previews without effects and moves the same booking while preserving links and duration', async () => {
    await seedBooking();
    const before = await storedBooking();
    const preview = await previewAssistantReschedule(ctx, booking, { start });
    expect(preview.reservesSlot).toBe(false);
    expect((await storedBooking()).start_time).toEqual(oldStart);
    const moved = await rescheduleAssistantBooking(ctx, booking, {
      start,
      expectedUpdatedAt: new Date(preview.expectedUpdatedAt),
    });
    expect(moved).toMatchObject({
      outcome: 'moved',
      booking: {
        id: booking,
        notes: 'preserved note',
        metadata: before.metadata,
        packageGrantId: before.package_grant_id,
        paymentPlanId: before.payment_plan_id,
        seriesId: before.series_id,
        seriesIndex: 3,
      },
    });
    expect(moved.booking.endTime.getTime() - moved.booking.startTime.getTime()).toBe(60 * 60_000);
    expect((await app!`select count(*)::int as count from sched_bookings`)[0].count).toBe(1);
  });

  it('returns a same-target replay without another write after availability changes', async () => {
    await seedBooking();
    const preview = await previewAssistantReschedule(ctx, booking, { start });
    const expectedUpdatedAt = new Date(preview.expectedUpdatedAt);
    const moved = await rescheduleAssistantBooking(ctx, booking, { start, expectedUpdatedAt });
    await app!`insert into hr_holidays(org_id,date,name,enabled) values(${org},'2030-01-07','New holiday',true)`;
    const replay = await rescheduleAssistantBooking(ctx, booking, { start, expectedUpdatedAt });
    expect(replay.outcome).toBe('already-at-target');
    expect(replay.booking.updatedAt).toEqual(moved.booking.updatedAt);
  });

  it('serializes competing moves and rejects the stale preview without a duplicate', async () => {
    await seedBooking();
    const first = new Date('2030-01-07T16:00:00Z');
    const second = new Date('2030-01-07T17:00:00Z');
    const preview = await previewAssistantReschedule(ctx, booking, { start: first });
    const expectedUpdatedAt = new Date(preview.expectedUpdatedAt);
    const results = await Promise.allSettled([
      rescheduleAssistantBooking(ctx, booking, { start: first, expectedUpdatedAt }),
      rescheduleAssistantBooking(ctx, booking, { start: second, expectedUpdatedAt }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    expect((await app!`select count(*)::int as count from sched_bookings`)[0].count).toBe(1);
  });

  it('serializes different originals targeting one resource slot without moving both', async () => {
    await seedBooking();
    const other = randomUUID();
    await seedBooking(other, {
      start: new Date('2030-01-07T18:00:00Z'),
      end: new Date('2030-01-07T19:00:00Z'),
    });
    const target = new Date('2030-01-07T16:30:00Z');
    const [firstPreview, secondPreview] = await Promise.all([
      previewAssistantReschedule(ctx, booking, { start: target }),
      previewAssistantReschedule(ctx, other, { start: target }),
    ]);
    const lockKey = Number.parseInt(randomUUID().slice(0, 8), 16);
    await app!.unsafe(`create function fixture_gate_move() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock_shared(${lockKey}); return new; end $$;
      create trigger fixture_gate_move before update on sched_bookings
        for each row execute function fixture_gate_move()`);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const admitted = new Promise<void>((done) => {
      ready = done;
    });
    const held = blocker!.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${lockKey})`;
      ready();
      await gate;
    });
    await admitted;
    const settled = Promise.allSettled([
      rescheduleAssistantBooking(ctx, booking, {
        start: target,
        expectedUpdatedAt: new Date(firstPreview.expectedUpdatedAt),
      }),
      rescheduleAssistantBooking(ctx, other, {
        start: target,
        expectedUpdatedAt: new Date(secondPreview.expectedUpdatedAt),
      }),
    ]);
    try {
      // The update trigger makes the old check-then-update race deterministic:
      // without a shared target lock both transactions pass availability before
      // either can commit. It never substitutes a scheduling decision.
      try {
        await waitForBlockedWriters();
      } finally {
        release();
        await held;
        await settled;
      }
      const results = await settled;
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(
        rejected?.status === 'rejected' &&
          (rejected.reason instanceof SlotUnavailableError ||
            rejected.reason instanceof BookingConflictError),
      ).toBe(true);
      const rows = await app!`select id,start_time from sched_bookings`;
      expect(rows).toHaveLength(2);
      expect(
        rows.filter((row) => new Date(row.start_time).getTime() === target.getTime()),
      ).toHaveLength(1);
    } finally {
      await app!.unsafe(
        'drop trigger fixture_gate_move on sched_bookings; drop function fixture_gate_move()',
      );
    }
  }, 15_000);

  it('rolls back an injected final-update failure with the original booking intact', async () => {
    await seedBooking();
    const preview = await previewAssistantReschedule(ctx, booking, { start });
    await app!.unsafe(`create function fixture_reject_move() returns trigger language plpgsql as $$
      begin raise exception 'fixture final move failure'; end $$;
      create trigger fixture_reject_move before update on sched_bookings
        for each row execute function fixture_reject_move()`);
    try {
      await expect(
        rescheduleAssistantBooking(ctx, booking, {
          start,
          expectedUpdatedAt: new Date(preview.expectedUpdatedAt),
        }),
      ).rejects.toThrow();
      expect((await storedBooking()).start_time).toEqual(oldStart);
      expect((await app!`select count(*)::int as count from sched_bookings`)[0].count).toBe(1);
    } finally {
      await app!.unsafe(
        'drop trigger fixture_reject_move on sched_bookings; drop function fixture_reject_move()',
      );
    }
  });

  it('rejects foreign originals and contacts before any move', async () => {
    await seedBooking();
    await expect(
      previewAssistantReschedule({ ...ctx, tenantId: foreignOrg }, booking, { start }),
    ).rejects.toMatchObject({ status: 404 });
    await app!`update sched_bookings set crm_contact_id=${foreignContact} where id=${booking}`;
    await expect(previewAssistantReschedule(ctx, booking, { start })).rejects.toMatchObject({
      status: 409,
    });
    expect((await storedBooking()).start_time).toEqual(oldStart);
  });

  it('excludes the original overlap but rejects another booking at the target', async () => {
    await seedBooking();
    await expect(previewAssistantReschedule(ctx, booking, { start })).resolves.toMatchObject({
      bookingId: booking,
    });
    await seedBooking(randomUUID(), {
      start: new Date('2030-01-07T16:00:00Z'),
      end: new Date('2030-01-07T17:00:00Z'),
    });
    await expect(previewAssistantReschedule(ctx, booking, { start })).rejects.toThrow();
    expect((await storedBooking()).start_time).toEqual(oldStart);
  });
});
