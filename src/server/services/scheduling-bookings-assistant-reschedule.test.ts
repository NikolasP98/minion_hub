import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
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
import type { CoreCtx } from '$server/auth/core-ctx';

const authority = vi.hoisted(() => ({ allowed: true, fieldLevel: 0 }));
vi.mock('../../routes/api/gateway/_shared/action-auth', () => ({
  requireAssistantCapability: async () => {
    if (!authority.allowed) throw Object.assign(new Error('denied'), { status: 403 });
    return { ctx, capabilities: { fieldLevel: () => authority.fieldLevel } };
  },
}));
// Real PostgreSQL transactions/rollback and the actual route/native service.
// TODO(handoff): qualify this assistant route under actual app_ledger role/GUC/RLS
// in the native PostgreSQL lane; PGlite proves transactions and scoped SQL only.
// See proposals/2026-11-06-agent-transcript-evals-and-runtime-improvements.md.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: CoreCtx, fn: Parameters<CoreCtx['db']['transaction']>[0]) =>
    scope.db.transaction(fn),
}));
vi.mock('./tag-links.service', () => ({ getTagLinks: vi.fn(), getContactTagsBulk: vi.fn() }));
vi.mock('./scheduling.service', () => ({ assertOrgEventKind: vi.fn(), catalogPrice: vi.fn() }));
vi.mock('./custom-properties.service', () => ({ putCustomPropertyValueInTx: vi.fn() }));
const effects = vi.hoisted(() => ({ emit: vi.fn(), accrue: vi.fn(), release: vi.fn() }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: effects.emit }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: effects.accrue,
  accrualSummaryForSources: vi.fn(),
  releaseAccruals: effects.release,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));
vi.mock('./activity.service', () => ({ recordAuditInTx: vi.fn() }));
vi.mock('./pos-packages.service', () => ({
  getGrant: vi.fn(),
  redeemSessionInTx: vi.fn(),
  reverseRedemptionInTx: vi.fn(),
}));
vi.mock('./pos-accounts.service', () => ({ getPlan: vi.fn() }));
vi.mock('./crm-contact-ensure', () => ({ ensureCrmContact: vi.fn() }));
vi.mock('./finance.service', () => ({ getFinSettings: vi.fn() }));
vi.mock('./pos/settings', () => ({ getPosCurrencyInTx: vi.fn() }));
vi.mock('./pos-accounts.logic', () => ({ grantToday: vi.fn() }));
import { POST } from '../../routes/api/gateway/actions/booking-reschedule/+server';

const pg = new PGlite();
const db = drizzle(pg);
const ctx = { db: db as unknown as CoreCtx['db'], tenantId: 'assistant-move-org' };
const booking = '10000000-0000-4000-8000-000000000001';
const missing = '10000000-0000-4000-8000-000000000099';
const resource = '20000000-0000-4000-8000-000000000001';
const alternate = '20000000-0000-4000-8000-000000000002';
const service = '30000000-0000-4000-8000-000000000001';
const contact = '40000000-0000-4000-8000-000000000001';
const schedule = '50000000-0000-4000-8000-000000000001';
const packageGrant = '60000000-0000-4000-8000-000000000001';
const plan = '60000000-0000-4000-8000-000000000002';
const series = '60000000-0000-4000-8000-000000000003';
const invoice = '60000000-0000-4000-8000-000000000004';
const originalStart = '2030-01-07T14:00:00.000Z'; // Monday 09:00 Lima
const originalEnd = '2030-01-07T15:00:00.000Z';
const targetStart = '2030-01-07T14:30:00.000Z'; // overlaps the ORIGINAL row
const originalVersion = '2029-12-01T00:00:00.000Z';
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
];

beforeAll(async () => {
  for (const table of tables) {
    const cfg = getTableConfig(table);
    await pg.exec(
      `CREATE TABLE "${cfg.name}" (${cfg.columns.map((c) => `"${c.name}" ${c.getSQLType()}`).join(',')})`,
    );
  }
  await pg.exec('CREATE UNIQUE INDEX booking_uid ON sched_bookings(org_id,uid)');
  await pg.exec('ALTER TABLE sched_bookings ALTER COLUMN id SET DEFAULT gen_random_uuid()');
});
afterAll(() => pg.close());
beforeEach(async () => {
  vi.clearAllMocks();
  authority.allowed = true;
  authority.fieldLevel = 0;
  await pg.exec('TRUNCATE ' + tables.map((t) => getTableConfig(t).name).join(','));
  await pg.query(
    `INSERT INTO sched_resources(id,org_id,name,timezone,active) VALUES
    ($1,$3,'Original Staff','America/Lima',true),($2,$3,'Alternate Staff','America/Lima',true)`,
    [resource, alternate, ctx.tenantId],
  );
  await pg.query(
    `INSERT INTO sched_event_types(id,org_id,title,active,length,slot_interval,
    before_buffer,after_buffer,minimum_booking_notice,period_type,requires_confirmation)
    VALUES ($1,$2,'Synthetic Service',true,30,30,0,0,0,'unlimited',false)`,
    [service, ctx.tenantId],
  );
  await pg.query(
    `INSERT INTO sched_event_type_resources(event_type_id,resource_id) VALUES ($1,$2),($1,$3)`,
    [service, resource, alternate],
  );
  for (const [id, staff] of [
    [schedule, resource],
    ['50000000-0000-4000-8000-000000000002', alternate],
  ]) {
    await pg.query(
      `INSERT INTO sched_schedules(id,org_id,resource_id,timezone) VALUES ($1,$2,$3,'America/Lima')`,
      [id, ctx.tenantId, staff],
    );
    await pg.query(
      `INSERT INTO sched_availability(schedule_id,days,start_time,end_time) VALUES ($1,ARRAY[1,2,3,4,5],'08:00','18:00')`,
      [id],
    );
  }
  await pg.query(
    `INSERT INTO crm_contacts(id,org_id,display_name) VALUES ($1,$2,'Synthetic Customer')`,
    [contact, ctx.tenantId],
  );
  await pg.query(
    `INSERT INTO sched_bookings(id,org_id,uid,event_type_id,resource_id,
    start_time,end_time,status,title,notes,attendee_name,attendee_email,attendee_phone,
    crm_contact_id,package_grant_id,payment_plan_id,series_id,series_index,invoice_id,
    metadata,created_at,updated_at) VALUES ($1,$2,'stable-booking-uid',$3,$4,$5,$6,'accepted',
    'Original title','Private note','Synthetic Customer','fixture@example.invalid','+15550000000',
    $7,$8,$9,$10,2,$11,'{"private":"preserve-only"}',$12,$12)`,
    [
      booking,
      ctx.tenantId,
      service,
      resource,
      originalStart,
      originalEnd,
      contact,
      packageGrant,
      plan,
      series,
      invoice,
      originalVersion,
    ],
  );
});

function post(patch: Record<string, unknown> = {}) {
  return POST({
    locals: {},
    url: new URL('https://fixture.invalid/api/gateway/actions/booking-reschedule'),
    request: new Request('https://fixture.invalid/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm: false,
        bookingId: booking,
        eventTypeId: service,
        start: targetStart,
        ...patch,
      }),
    }),
  } as never);
}
async function stored() {
  return (
    await pg.query<Record<string, unknown>>('SELECT * FROM sched_bookings WHERE id=$1', [booking])
  ).rows[0];
}
async function count() {
  return Number(
    (await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM sched_bookings')).rows[0].n,
  );
}
async function preview(patch: Record<string, unknown> = {}) {
  return (await (await post(patch)).json()).preview;
}

describe('assistant reschedule executes the native same-booking transaction', () => {
  it('rejects a nonexistent original during preview', async () => {
    await expect(post({ bookingId: missing })).rejects.toMatchObject({ status: 404 });
    expect(await count()).toBe(1);
  });
  it('denies authority before reading or changing an original', async () => {
    authority.allowed = false;
    await expect(post({ confirm: true, expectedUpdatedAt: originalVersion })).rejects.toMatchObject(
      { status: 403 },
    );
    expect(await stored()).toMatchObject({ start_time: new Date(originalStart) });
  });
  it('returns a resolved non-reserving preview without changing rows or effects', async () => {
    const before = await stored();
    const result = await preview();
    expect(result).toMatchObject({
      action: 'booking-reschedule',
      bookingId: booking,
      eventTypeId: service,
      oldStart: originalStart,
      oldEnd: originalEnd,
      start: targetStart,
      end: '2030-01-07T15:30:00.000Z',
      resourceId: resource,
      resourceName: 'Original Staff',
      timezone: 'America/Lima',
      expectedUpdatedAt: originalVersion,
      reservesSlot: false,
      availability: 'available-at-preview',
    });
    expect(result).not.toHaveProperty('metadata');
    expect(result).not.toHaveProperty('paymentPlanId');
    expect(result.attendeeEmail).not.toBe('fixture@example.invalid');
    expect(result.attendeePhone).not.toBe('+15550000000');
    expect(await stored()).toEqual(before);
    expect(await count()).toBe(1);
    expect(effects.emit).not.toHaveBeenCalled();
  });
  it('moves the same ID across its old slot and preserves duration and funding links', async () => {
    const before = await stored();
    const result = await (await post({ confirm: true, expectedUpdatedAt: originalVersion })).json();
    const after = await stored();
    expect(result).toMatchObject({
      outcome: 'moved',
      booking: {
        id: booking,
        startTime: targetStart,
        endTime: '2030-01-07T15:30:00.000Z',
        resourceId: resource,
      },
    });
    expect(result).not.toHaveProperty('cancelledBookingId');
    expect(result.booking).not.toHaveProperty('metadata');
    expect(result.booking).not.toHaveProperty('packageGrantId');
    expect(result.booking.attendeeEmail).not.toBe('fixture@example.invalid');
    for (const field of [
      'id',
      'uid',
      'event_type_id',
      'package_grant_id',
      'payment_plan_id',
      'series_id',
      'series_index',
      'invoice_id',
      'metadata',
      'notes',
      'status',
      'created_at',
    ])
      expect(after[field]).toEqual(before[field]);
    expect(after.start_time).toEqual(new Date(targetStart));
    expect(after.end_time).toEqual(new Date('2030-01-07T15:30:00Z'));
    expect(new Date(after.updated_at as string).getTime()).toBeGreaterThan(
      new Date(originalVersion).getTime(),
    );
    expect(await count()).toBe(1);
    expect(effects.accrue).not.toHaveBeenCalled();
    expect(effects.release).not.toHaveBeenCalled();
    expect((await pg.query('SELECT * FROM sched_booking_status_log')).rows).toHaveLength(0);
  });
  it('requires a valid preview version before a confirmed move', async () => {
    await expect(post({ confirm: true })).rejects.toMatchObject({ status: 400 });
    await expect(post({ confirm: true, expectedUpdatedAt: null })).rejects.toMatchObject({
      status: 400,
    });
    await expect(post({ confirm: true, expectedUpdatedAt: 'invalid' })).rejects.toMatchObject({
      status: 400,
    });
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it.each([null, true, 0, 'invalid', '2030-01-07T14:30:00'])(
    'rejects an ambiguous or malformed start %s',
    async (start) => {
      await expect(post({ start })).rejects.toMatchObject({ status: 400 });
      expect((await stored()).start_time).toEqual(new Date(originalStart));
    },
  );
  it('serializes competing same-booking confirmations and rejects the stale loser', async () => {
    const results = await Promise.allSettled([
      post({ confirm: true, expectedUpdatedAt: originalVersion }),
      post({ confirm: true, start: '2030-01-07T16:00:00Z', expectedUpdatedAt: originalVersion }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    expect(await count()).toBe(1);
  });
  it('rejects stale confirmation but reconciles an exact same-target retry without effects', async () => {
    await post({ confirm: true, expectedUpdatedAt: originalVersion });
    const settled = await stored();
    const retried = await (
      await post({ confirm: true, expectedUpdatedAt: originalVersion })
    ).json();
    expect(retried).toMatchObject({
      outcome: 'already-at-target',
      booking: { id: booking, startTime: targetStart },
    });
    expect(await stored()).toEqual(settled);
    await expect(
      post({ confirm: true, start: '2030-01-07T16:00:00Z', expectedUpdatedAt: originalVersion }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await stored()).toEqual(settled);
    expect(await count()).toBe(1);
  });
  it('advances versions monotonically even when clock time is behind the stored version', async () => {
    const first = await (await post({ confirm: true, expectedUpdatedAt: originalVersion })).json();
    const second = await (
      await post({
        confirm: true,
        start: '2030-01-07T16:00:00Z',
        expectedUpdatedAt: first.booking.updatedAt,
      })
    ).json();
    expect(new Date(second.booking.updatedAt).getTime()).toBeGreaterThan(
      new Date(first.booking.updatedAt).getTime(),
    );
    expect(await count()).toBe(1);
  });
  it.each([
    'eventTypeId',
    'crmContactId',
    'attendeeName',
    'attendeeEmail',
    'attendeePhone',
    'notes',
  ])('rejects changing %s instead of silently discarding it', async (field) => {
    const value = field.endsWith('Id') ? missing : 'a different value';
    await expect(post({ [field]: value })).rejects.toMatchObject({ status: 409 });
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it('allows identical legacy identity fields and keeps omitted fields unchanged', async () => {
    const result = await preview({
      crmContactId: contact,
      attendeeName: 'Synthetic Customer',
      attendeeEmail: 'fixture@example.invalid',
      attendeePhone: '+15550000000',
      notes: 'Private note',
    });
    expect(result.bookingId).toBe(booking);
    expect(result.resourceId).toBe(resource);
  });
  it('rejects a foreign original without leaking it', async () => {
    await pg.query('UPDATE sched_bookings SET org_id=$1 WHERE id=$2', ['foreign-org', booking]);
    await expect(post()).rejects.toMatchObject({ status: 404 });
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it('rejects deleted/foreign explicit contacts and inactive target resources', async () => {
    await pg.query('UPDATE crm_contacts SET deleted_at=now() WHERE id=$1', [contact]);
    await expect(post({ crmContactId: contact })).rejects.toMatchObject({ status: 409 });
    await pg.query('UPDATE crm_contacts SET deleted_at=null,org_id=$1 WHERE id=$2', [
      'foreign-org',
      contact,
    ]);
    await expect(post({ crmContactId: contact })).rejects.toMatchObject({ status: 409 });
    await pg.query('UPDATE crm_contacts SET org_id=$1 WHERE id=$2', [ctx.tenantId, contact]);
    await pg.query('UPDATE sched_resources SET active=false WHERE id=$1', [alternate]);
    await expect(post({ resourceId: alternate })).rejects.toMatchObject({ status: 409 });
  });
  it('moves to an eligible active resource with its timezone', async () => {
    const result = await preview({ resourceId: alternate });
    expect(result).toMatchObject({
      resourceId: alternate,
      resourceName: 'Alternate Staff',
      timezone: 'America/Lima',
    });
    await post({ confirm: true, resourceId: alternate, expectedUpdatedAt: originalVersion });
    expect((await stored()).resource_id).toBe(alternate);
  });
  it('rejects a grouped member with no partial group move', async () => {
    await pg.query(
      `UPDATE sched_bookings SET metadata='{"groupId":"synthetic-group","groupSeq":0}' WHERE id=$1`,
      [booking],
    );
    await expect(post()).rejects.toMatchObject({
      status: 409,
      body: { message: expect.stringMatching(/group/i) },
    });
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it.each(['cancelled', 'rejected'])('rejects a %s booking', async (status) => {
    await pg.query('UPDATE sched_bookings SET status=$1 WHERE id=$2', [status, booking]);
    await expect(post()).rejects.toMatchObject({ status: 409 });
  });
  it('revalidates when another booking occupies the previewed target', async () => {
    await preview();
    await pg.query(
      `INSERT INTO sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,status,metadata)
      VALUES ($1,$2,'other',$3,$4,$5,$6,'completed','{}')`,
      [missing, ctx.tenantId, service, resource, targetStart, '2030-01-07T15:30:00Z'],
    );
    await expect(post({ confirm: true, expectedUpdatedAt: originalVersion })).rejects.toMatchObject(
      { status: 409 },
    );
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it('keeps assistant working-hours policy instead of inheriting human drag overrides', async () => {
    await expect(post({ start: '2030-01-07T02:00:00Z' })).rejects.toMatchObject({ status: 409 });
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it('respects an organization holiday during preview and confirmation', async () => {
    await pg.query(
      `INSERT INTO hr_holidays(id,org_id,date,name,enabled) VALUES ($1,$2,'2030-01-07','Synthetic closure',true)`,
      ['70000000-0000-4000-8000-000000000001', ctx.tenantId],
    );
    await expect(post()).rejects.toMatchObject({ status: 409 });
    await expect(post({ confirm: true, expectedUpdatedAt: originalVersion })).rejects.toMatchObject(
      { status: 409 },
    );
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it('respects approved staff leave and rechecks it after preview', async () => {
    await preview();
    await pg.query(
      `INSERT INTO hr_employees(id,org_id,resource_id,name) VALUES ($1,$2,$3,'Synthetic Employee')`,
      ['70000000-0000-4000-8000-000000000002', ctx.tenantId, resource],
    );
    await pg.query(
      `INSERT INTO hr_leave_requests(org_id,employee_id,from_date,to_date,status)
      VALUES ($1,$2,'2030-01-07','2030-01-07','approved')`,
      [ctx.tenantId, '70000000-0000-4000-8000-000000000002'],
    );
    await expect(post()).rejects.toMatchObject({ status: 409 });
    await expect(post({ confirm: true, expectedUpdatedAt: originalVersion })).rejects.toMatchObject(
      { status: 409 },
    );
    expect((await stored()).start_time).toEqual(new Date(originalStart));
  });
  it('returns permitted contact fields while still withholding raw linked data', async () => {
    authority.fieldLevel = 1;
    const result = await preview();
    expect(result).toMatchObject({
      attendeeEmail: 'fixture@example.invalid',
      attendeePhone: '+15550000000',
    });
    expect(result).not.toHaveProperty('metadata');
    expect(result).not.toHaveProperty('invoiceId');
  });
  it('rejects foreign or non-assigned replacement resources', async () => {
    await pg.query('UPDATE sched_resources SET org_id=$1 WHERE id=$2', ['foreign-org', alternate]);
    await expect(post({ resourceId: alternate })).rejects.toMatchObject({ status: 409 });
    await pg.query('UPDATE sched_resources SET org_id=$1 WHERE id=$2', [ctx.tenantId, alternate]);
    await pg.query('DELETE FROM sched_event_type_resources WHERE resource_id=$1', [alternate]);
    await expect(post({ resourceId: alternate })).rejects.toMatchObject({ status: 409 });
  });
  it('reconciles the stored same target after availability closes without a new write', async () => {
    await post({ confirm: true, expectedUpdatedAt: originalVersion });
    const settled = await stored();
    await pg.query(
      `INSERT INTO hr_holidays(org_id,date,name,enabled) VALUES ($1,'2030-01-07','Later closure',true)`,
      [ctx.tenantId],
    );
    const result = await (await post({ confirm: true, expectedUpdatedAt: originalVersion })).json();
    expect(result.outcome).toBe('already-at-target');
    expect(await stored()).toEqual(settled);
    expect(await count()).toBe(1);
  });
  it('reconciles a persisted same target after its contact was deleted without changing its link', async () => {
    await post({ confirm: true, expectedUpdatedAt: originalVersion });
    const settled = await stored();
    await pg.query('UPDATE crm_contacts SET deleted_at=now() WHERE id=$1', [contact]);
    const result = await (await post({ confirm: true, expectedUpdatedAt: originalVersion })).json();
    expect(result).toMatchObject({
      outcome: 'already-at-target',
      booking: { id: booking, crmContactId: contact },
    });
    expect(await stored()).toEqual(settled);
    await expect(post({ start: '2030-01-07T16:00:00Z' })).rejects.toMatchObject({ status: 409 });
  });
  it('does not change the original when the native update fails', async () => {
    await pg.exec(
      `ALTER TABLE sched_bookings ADD CONSTRAINT reject_fixture_move CHECK(start_time < '2030-01-07T14:15:00Z')`,
    );
    const before = await stored();
    try {
      await expect(post({ confirm: true, expectedUpdatedAt: originalVersion })).rejects.toThrow();
      expect(await stored()).toEqual(before);
      expect(await count()).toBe(1);
    } finally {
      await pg.exec('ALTER TABLE sched_bookings DROP CONSTRAINT reject_fixture_move');
    }
  });
});
