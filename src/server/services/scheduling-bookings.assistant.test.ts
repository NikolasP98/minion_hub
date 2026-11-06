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
} from '../db/pg-scheduling-schema';
import { crmContacts } from '../db/pg-crm-schema';
import type { CoreCtx } from '../auth/core-ctx';

const effects = vi.hoisted(() => ({
  emit: vi.fn(),
  accrual: vi.fn(),
  ensureContact: vi.fn(),
}));
// TODO(handoff): qualify actual app_ledger role/GUC RLS in a disposable native
// PostgreSQL fixture before product adoption; this mock proves scoped SQL only.
// See proposals/2026-11-06-agent-transcript-evals-and-runtime-improvements.md.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: CoreCtx, fn: Parameters<CoreCtx['db']['transaction']>[0]) =>
    ctx.db.transaction(fn),
}));
vi.mock('./tag-links.service', () => ({
  getTagLinks: vi.fn(),
  getContactTagsBulk: vi.fn(),
}));
vi.mock('./scheduling.service', () => ({
  assertOrgEventKind: vi.fn(),
  catalogPrice: vi.fn(),
}));
vi.mock('./custom-properties.service', () => ({
  putCustomPropertyValueInTx: vi.fn(),
}));
vi.mock('$server/events/emit', () => ({ emitHubEvent: effects.emit }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: effects.accrual,
  accrualSummaryForSources: vi.fn(),
  releaseAccruals: vi.fn(),
}));
vi.mock('./modules.service', () => ({
  isModuleEnabled: async () => false,
}));
vi.mock('./activity.service', () => ({
  recordAuditInTx: vi.fn(),
}));
vi.mock('./pos-packages.service', () => ({
  getGrant: vi.fn(),
  redeemSessionInTx: vi.fn(),
  reverseRedemptionInTx: vi.fn(),
}));
vi.mock('./pos-accounts.service', () => ({
  getPlan: vi.fn(),
}));
vi.mock('./crm-contact-ensure', () => ({
  ensureCrmContact: effects.ensureContact,
}));
vi.mock('./finance.service', () => ({
  getFinSettings: vi.fn(),
}));
vi.mock('./pos/settings', () => ({
  getPosCurrencyInTx: vi.fn(),
}));
vi.mock('./pos-accounts.logic', () => ({
  grantToday: vi.fn(),
}));
vi.mock('./scheduling-slots.service', () => ({
  serviceRulesOf: () => undefined,
}));
import {
  queryAssistantBookings,
  listBookings,
  previewAssistantBooking,
  createBooking,
} from './scheduling-bookings.service';

const pg = new PGlite();
const statements: string[] = [];
const db = drizzle(pg, {
  logger: { logQuery: (query: string) => statements.push(query) },
});
const ctx = {
  db: db as unknown as CoreCtx['db'],
  tenantId: 'synthetic-org',
  profileId: 'synthetic-actor',
};
const resource = '20000000-0000-4000-8000-000000000001';
const service = '30000000-0000-4000-8000-000000000001';
const contact = '40000000-0000-4000-8000-000000000001';
const missing = '40000000-0000-4000-8000-000000000002';
const start = new Date('2030-01-07T14:00:00Z');
const input = {
  eventTypeId: service,
  start,
  crmContactId: contact,
  preferredResourceId: resource,
  bypassRules: true,
  strictContactReference: true,
};
const tables = [
  schedBookings,
  schedBookingStatusLog,
  schedEventTypes,
  schedEventTypeResources,
  schedResources,
  schedSchedules,
  schedAvailability,
  crmContacts,
];
beforeAll(async () => {
  for (const table of tables) {
    const cfg = getTableConfig(table);
    await pg.exec(
      `CREATE TABLE "${cfg.name}" (${cfg.columns.map((c) => `"${c.name}" ${c.getSQLType()}`).join(',')})`,
    );
  }
  // Native create's conflict target needs its actual uniqueness contract.
  await pg.exec('CREATE UNIQUE INDEX booking_uid ON sched_bookings(org_id,uid)');
});
afterAll(() => pg.close());
beforeEach(async () => {
  vi.clearAllMocks();
  effects.ensureContact.mockResolvedValue(null);
  await pg.exec('TRUNCATE ' + tables.map((t) => getTableConfig(t).name).join(','));
  await pg.query(
    'INSERT INTO sched_resources(id,org_id,name,timezone,active) VALUES ($1,$2,$3,$4,true)',
    [resource, ctx.tenantId, 'Synthetic Staff', 'America/Lima'],
  );
  await pg.query(
    `INSERT INTO sched_event_types(id,org_id,title,active,length,before_buffer,after_buffer,minimum_booking_notice,period_type,requires_confirmation) VALUES ($1,$2,$3,true,60,0,0,0,'unlimited',false)`,
    [service, ctx.tenantId, 'Synthetic Service'],
  );
  await pg.query(
    'INSERT INTO sched_event_type_resources(event_type_id,resource_id) VALUES ($1,$2)',
    [service, resource],
  );
  await pg.query(
    "INSERT INTO sched_schedules(id,org_id,resource_id,timezone) VALUES ('50000000-0000-4000-8000-000000000001',$1,$2,'America/Lima')",
    [ctx.tenantId, resource],
  );
  await pg.exec(
    "INSERT INTO sched_availability(schedule_id,days,start_time,end_time) VALUES ('50000000-0000-4000-8000-000000000001',ARRAY[1,2,3,4,5],'08:00','18:00')",
  );
  await pg.query('INSERT INTO crm_contacts(id,org_id,display_name) VALUES ($1,$2,$3)', [
    contact,
    ctx.tenantId,
    'Synthetic Customer',
  ]);
});
async function seedBookings(n: number) {
  // Tied start times deliberately exercise stable id ordering, with 1 foreign row.
  await pg.query(
    `INSERT INTO sched_bookings(id,org_id,uid,event_type_id,resource_id,start_time,end_time,status,attendee_email,attendee_phone)
    SELECT ('60000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,$1,i::text,$2,$3,$4::timestamptz,$4::timestamptz+interval '1 hour','accepted','fixture@example.invalid','+15550000000' FROM generate_series(1,$5::integer) i`,
    [ctx.tenantId, service, resource, start, n],
  );
  await pg.query(
    "INSERT INTO sched_bookings(id,org_id,start_time,status) VALUES ('70000000-0000-4000-8000-000000000001','foreign-org',$1,'accepted')",
    [start],
  );
}

async function tableSnapshot() {
  return Promise.all(
    tables.map(async (table) => {
      const name = getTableConfig(table).name;
      return { name, rows: (await pg.query(`SELECT * FROM "${name}"`)).rows };
    }),
  );
}

async function rejectsReadOnlyPreview(patch: Partial<typeof input> = {}) {
  const before = await tableSnapshot();
  statements.length = 0;
  await expect(previewAssistantBooking(ctx, { ...input, ...patch })).rejects.toThrow(
    'slot no longer available',
  );
  expect(statements.some((query) => /^\s*select\b/i.test(query))).toBe(true);
  expect(
    statements.filter((query) => /^\s*(insert|update|delete|truncate|alter|create)\b/i.test(query)),
  ).toEqual([]);
  expect(await tableSnapshot()).toEqual(before);
  expect(effects.emit).not.toHaveBeenCalled();
  expect(effects.ensureContact).not.toHaveBeenCalled();
  expect(effects.accrual).not.toHaveBeenCalled();
}

describe('C03 native shared slot preflight', () => {
  it('resolves identities and timezone without mutating any table or invoking effects', async () => {
    const preview = await previewAssistantBooking(ctx, input);
    expect(preview).toMatchObject({
      eventTypeId: service,
      resourceId: resource,
      crmContactId: contact,
      serviceTitle: 'Synthetic Service',
      contactName: 'Synthetic Customer',
      resourceName: 'Synthetic Staff',
      timezone: 'America/Lima',
      start: start.toISOString(),
      end: '2030-01-07T15:00:00.000Z',
      reservesSlot: false,
    });
    expect((await pg.query('SELECT count(*)::int n FROM sched_bookings')).rows).toEqual([{ n: 0 }]);
    expect((await pg.query('SELECT count(*)::int n FROM sched_booking_status_log')).rows).toEqual([
      { n: 0 },
    ]);
    expect(effects.emit).not.toHaveBeenCalled();
    expect(effects.accrual).not.toHaveBeenCalled();
    expect(effects.ensureContact).not.toHaveBeenCalled();
  });
  it.each([{ eventTypeId: missing }, { preferredResourceId: missing }, { crmContactId: missing }])(
    'rejects unknown/foreign reference %j',
    async (patch) => {
      await expect(previewAssistantBooking(ctx, { ...input, ...patch })).rejects.toThrow();
    },
  );
  it('rejects a foreign service, contact and resource even when their ids exist', async () => {
    for (const table of ['sched_event_types', 'crm_contacts', 'sched_resources']) {
      await pg.query(`UPDATE ${table} SET org_id='foreign-org'`);
      await expect(previewAssistantBooking(ctx, input)).rejects.toThrow();
      await pg.query(`UPDATE ${table} SET org_id=$1`, [ctx.tenantId]);
    }
  });
  it('rejects an inactive event type before preview without writes or effects', async () => {
    await pg.query('UPDATE sched_event_types SET active=false WHERE id=$1', [service]);
    await rejectsReadOnlyPreview();
  });
  it('rejects an inactive assigned resource before preview without writes or effects', async () => {
    await pg.query('UPDATE sched_resources SET active=false WHERE id=$1', [resource]);
    await rejectsReadOnlyPreview();
  });
  it('rejects an existing same-tenant unassigned resource before preview without writes or effects', async () => {
    await pg.query(
      'INSERT INTO sched_resources(id,org_id,name,timezone,active) VALUES ($1,$2,$3,$4,true)',
      [missing, ctx.tenantId, 'Synthetic Unassigned Staff', 'America/Lima'],
    );
    await rejectsReadOnlyPreview({ preferredResourceId: missing });
  });
  it('rejects a soft-deleted explicit contact before preview without writes or effects', async () => {
    await pg.query('UPDATE crm_contacts SET deleted_at=$1 WHERE id=$2', [
      new Date('2030-01-01T00:00:00Z'),
      contact,
    ]);
    await rejectsReadOnlyPreview();
  });
  it('rejects an already occupied slot before preview without writes or effects', async () => {
    await seedBookings(1);
    await rejectsReadOnlyPreview();
  });
  it('revalidates availability at commit after another booking takes the previewed slot', async () => {
    await previewAssistantBooking(ctx, input);
    await seedBookings(1);
    await expect(createBooking(ctx, input)).rejects.toThrow('slot no longer available');
    expect(effects.emit).not.toHaveBeenCalled();
  });
  it('revalidates strict contact at commit; shared UI fallback remains optional', async () => {
    await previewAssistantBooking(ctx, input);
    await pg.exec('DELETE FROM crm_contacts');
    await expect(createBooking(ctx, input)).rejects.toThrow();
    expect(effects.ensureContact).not.toHaveBeenCalled();
  });
});

describe('C04 actual SQL completeness and masking', () => {
  it('reports 501 with 500 bounded rows, ties ordered stably, and exact count mode', async () => {
    await seedBookings(501);
    const opts = {
      from: start,
      to: start,
      status: ['accepted'],
      maskAttendeePii: true,
    };
    const result = await queryAssistantBookings(ctx, opts);
    expect(result).toMatchObject({
      total: 501,
      returned: 500,
      truncated: true,
      limit: 500,
      mode: 'list',
    });
    expect(result.bookings[0].id).toBe('60000000-0000-4000-8000-000000000501');
    expect(result.bookings[499].id).toBe('60000000-0000-4000-8000-000000000002');
    expect(result.bookings[0].attendeeEmail).not.toBe('fixture@example.invalid');
    expect(result.bookings[0].attendeePhone).not.toBe('+15550000000');
    expect(await queryAssistantBookings(ctx, { ...opts, countOnly: true })).toMatchObject({
      total: 501,
      returned: 0,
      bookings: [],
      mode: 'count',
    });
    expect(await listBookings(ctx, opts)).toHaveLength(500);
  });
  it('proves complete narrow/empty ranges and keeps inclusive instant boundaries', async () => {
    await seedBookings(2);
    expect(await queryAssistantBookings(ctx, { from: start, to: start })).toMatchObject({
      total: 2,
      truncated: false,
    });
    expect(
      await queryAssistantBookings(ctx, {
        from: new Date(start.getTime() + 1),
      }),
    ).toMatchObject({ total: 0, returned: 0, truncated: false });
    expect(await queryAssistantBookings(ctx, { status: ['cancelled'] })).toMatchObject({
      total: 0,
    });
  });
});
