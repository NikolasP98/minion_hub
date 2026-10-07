/**
 * HC-011A/B — a booking move that carries a custom-column write is ONE
 * transaction: `patchBooking` / `moveGroup` apply `properties` through
 * `putCustomPropertyValueInTx` after their conflict check, so a refused value
 * (stale version, archived option/property, foreign record) rolls the
 * reschedule back, and a refused move leaves the value untouched. Real
 * PostgreSQL semantics on PGlite (advisory lock, FOR UPDATE, ON CONFLICT …
 * WHERE version = …), the same fixture pattern as scheduling-bookings-atomic.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  schedBookingStatusLog,
  schedBookings,
  schedEventTypes,
  schedResources,
} from '$server/db/pg-scheduling-schema';
import { posPackageRedemptions } from '$server/db/pg-pos-schema';
import { finInvoices } from '$server/db/pg-finance-schema';
import { appTableProperties, appTablePropertyValues } from '$server/db/pg-schema/custom-properties';
import type { CoreCtx } from '$server/auth/core-ctx';

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: CoreCtx, fn: Parameters<CoreCtx['db']['transaction']>[0]) =>
    ctx.db.transaction(fn),
}));
vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: vi.fn(),
  releaseAccruals: vi.fn(async () => 0),
  realizeAccruals: vi.fn(),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));
vi.mock('./activity.service', () => ({ recordAuditInTx: vi.fn(async () => undefined) }));
import { BookingConflictError, moveGroup, patchBooking } from './scheduling-bookings.service';
import {
  CustomPropertyError,
  putCustomPropertyValue,
  putCustomPropertyValueInTx,
} from './custom-properties.service';

const client = new PGlite();
const db = drizzle(client);
const ctx = {
  db: db as unknown as CoreCtx['db'],
  tenantId: 'fixture-org',
  profileId: 'fixture-actor',
};
const TABLE = 'scheduling.bookings';
const b1 = '10000000-0000-4000-8000-000000000001';
const b2 = '10000000-0000-4000-8000-000000000002';
const blocker = '10000000-0000-4000-8000-000000000009';
const resource = '20000000-0000-4000-8000-000000000001';
const eventType = '30000000-0000-4000-8000-000000000001';
const prop = '50000000-0000-4000-8000-000000000001';
const archivedProp = '50000000-0000-4000-8000-000000000002';
const group = 'visit-1';
const start = new Date('2026-09-12T14:00:00Z');
const end = new Date('2026-09-12T15:00:00Z');
const later = { start: new Date('2026-09-12T16:00:00Z'), end: new Date('2026-09-12T17:00:00Z') };
/** 10:00–11:00 holds `blocker`: a move there is a conflict. */
const clash = { start: new Date('2026-09-12T10:00:00Z'), end: new Date('2026-09-12T11:00:00Z') };
const rules = {
  type: 'select',
  options: [
    { id: 'a', label: 'A', color: null, archivedAt: null },
    { id: 'b', label: 'B', color: null, archivedAt: null },
    { id: 'z', label: 'Z', color: null, archivedAt: '2026-01-01T00:00:00.000Z' },
  ],
};

beforeAll(async () => {
  for (const table of [
    schedBookings,
    schedBookingStatusLog,
    schedEventTypes,
    schedResources,
    finInvoices,
    posPackageRedemptions,
    appTableProperties,
    appTablePropertyValues,
  ]) {
    const config = getTableConfig(table);
    await client.exec(
      `CREATE TABLE "${config.name}" (${config.columns.map((c) => `"${c.name}" ${c.getSQLType()}`).join(',')})`,
    );
  }
  // The CAS upsert targets this key.
  await client.exec(
    'ALTER TABLE app_table_property_values ADD PRIMARY KEY (org_id, property_id, record_id)',
  );
});
afterAll(() => client.close());
beforeEach(async () => {
  await client.exec(
    'TRUNCATE sched_bookings, sched_booking_status_log, sched_resources, sched_event_types, fin_invoices, pos_package_redemptions, app_table_properties, app_table_property_values',
  );
  const insert =
    'INSERT INTO sched_bookings (id,org_id,uid,event_type_id,resource_id,start_time,end_time,status,title,metadata) VALUES ($1::uuid,$2,($1::uuid)::text,$3,$4,$5,$6,$7,$8,$9::jsonb)';
  await client.query(insert, [
    b1,
    ctx.tenantId,
    eventType,
    resource,
    start,
    end,
    'accepted',
    'One',
    '{}',
  ]);
  // b2 sits apart from b1 until the visit tests join them at one window.
  await client.query(insert, [
    b2,
    ctx.tenantId,
    eventType,
    resource,
    new Date('2026-09-12T12:00:00Z'),
    new Date('2026-09-12T13:00:00Z'),
    'accepted',
    'Two',
    JSON.stringify({ groupId: group, groupSeq: 1, groupLength: 60 }),
  ]);
  await client.query(insert, [
    blocker,
    ctx.tenantId,
    eventType,
    resource,
    clash.start,
    clash.end,
    'accepted',
    'Blocker',
    '{}',
  ]);
  await client.query('INSERT INTO sched_resources (id,org_id,active) VALUES ($1,$2,true)', [
    resource,
    ctx.tenantId,
  ]);
  await client.query(
    'INSERT INTO sched_event_types (id,org_id,before_buffer,after_buffer) VALUES ($1,$2,0,0)',
    [eventType, ctx.tenantId],
  );
  const insertProp =
    'INSERT INTO app_table_properties (id,org_id,table_id,label,rules,has_default,version,archived_at,created_by,updated_by,created_at,updated_at) VALUES ($1::uuid,$2,$3,$4,$5::jsonb,0,1,$6,$7,$7,now(),now())';
  await client.query(insertProp, [
    prop,
    ctx.tenantId,
    TABLE,
    'Room',
    JSON.stringify(rules),
    null,
    'x',
  ]);
  await client.query(insertProp, [
    archivedProp,
    ctx.tenantId,
    TABLE,
    'Old',
    JSON.stringify(rules),
    new Date('2026-01-01T00:00:00Z'),
    'x',
  ]);
});

async function booking(id: string) {
  return (
    await client.query<{ start_epoch: number; resource_id: string }>(
      'SELECT extract(epoch from start_time)::float8 AS start_epoch, resource_id FROM sched_bookings WHERE id=$1',
      [id],
    )
  ).rows[0];
}
const at = (d: Date) => d.getTime() / 1000;
async function value(id: string, propertyId = prop) {
  return (
    (
      await client.query<{ value: unknown; version: number }>(
        'SELECT value, version FROM app_table_property_values WHERE record_id=$1 AND property_id=$2',
        [id, propertyId],
      )
    ).rows[0] ?? null
  );
}
const write = (recordId: string, v: string | null, expectedVersion = 0) => ({
  propertyId: prop,
  recordId,
  value: v,
  expectedVersion,
});

describe('putCustomPropertyValueInTx (HC-011A)', () => {
  it('keeps the CAS inside the caller transaction: a stale version rejects and rolls the caller back', async () => {
    await putCustomPropertyValue(ctx, TABLE, prop, b1, 'a', 0);
    expect(await value(b1)).toEqual({ value: 'a', version: 1 });
    await expect(
      db.transaction(async (tx) => {
        const first = await putCustomPropertyValueInTx(tx as never, ctx, TABLE, prop, b1, 'b', 1);
        expect(first).toMatchObject({ value: 'b', version: 2 });
        await putCustomPropertyValueInTx(tx as never, ctx, TABLE, prop, b1, 'a', 0); // stale
      }),
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    // The successful first write inside the same transaction rolled back with it.
    expect(await value(b1)).toEqual({ value: 'a', version: 1 });
  });

  it('the public wrapper still writes through its own transaction', async () => {
    const cell = await putCustomPropertyValue(ctx, TABLE, prop, b1, 'b', 0);
    expect(cell).toMatchObject({ value: 'b', version: 1 });
    expect(await value(b1)).toEqual({ value: 'b', version: 1 });
  });
});

describe('patchBooking with properties (HC-011B, single)', () => {
  it('success: time and lane commit together', async () => {
    await patchBooking(ctx, b1, { ...later, resourceId: resource, properties: [write(b1, 'b')] });
    expect((await booking(b1)).start_epoch).toBe(at(later.start));
    expect(await value(b1)).toEqual({ value: 'b', version: 1 });
  });

  it('property stage fails (archived option) → booking row unchanged, no value row', async () => {
    const before = await booking(b1);
    await expect(
      patchBooking(ctx, b1, { ...later, resourceId: resource, properties: [write(b1, 'z')] }),
    ).rejects.toMatchObject({ status: 422, code: 'archived_option' });
    expect(await booking(b1)).toEqual(before);
    expect(await value(b1)).toBeNull();
  });

  it('property stage fails (stale version) → booking row unchanged, value row unchanged', async () => {
    await putCustomPropertyValue(ctx, TABLE, prop, b1, 'a', 0);
    const before = await booking(b1);
    await expect(
      patchBooking(ctx, b1, { ...later, resourceId: resource, properties: [write(b1, 'b', 0)] }),
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    expect(await booking(b1)).toEqual(before);
    expect(await value(b1)).toEqual({ value: 'a', version: 1 });
  });

  it('property stage fails (archived property) → nothing written', async () => {
    const before = await booking(b1);
    await expect(
      patchBooking(ctx, b1, {
        ...later,
        resourceId: resource,
        properties: [{ ...write(b1, 'b'), propertyId: archivedProp }],
      }),
    ).rejects.toMatchObject({ status: 404, code: 'property_unavailable' });
    expect(await booking(b1)).toEqual(before);
    expect(await value(b1, archivedProp)).toBeNull();
  });

  it('a write naming another record is refused and nothing moves', async () => {
    const before = await booking(b1);
    await expect(
      patchBooking(ctx, b1, { ...later, resourceId: resource, properties: [write(b2, 'b')] }),
    ).rejects.toThrow('property record is not part of this booking');
    expect(await booking(b1)).toEqual(before);
    expect(await value(b2)).toBeNull();
  });

  it('move stage fails (conflict) → value row untouched', async () => {
    await putCustomPropertyValue(ctx, TABLE, prop, b1, 'a', 0);
    await expect(
      patchBooking(ctx, b1, { ...clash, resourceId: resource, properties: [write(b1, 'b', 1)] }),
    ).rejects.toBeInstanceOf(BookingConflictError);
    expect((await booking(b1)).start_epoch).toBe(at(start));
    expect(await value(b1)).toEqual({ value: 'a', version: 1 });
  });

  it('a lane-only change (same window) still commits the value', async () => {
    await patchBooking(ctx, b1, { start, end, resourceId: resource, properties: [write(b1, 'b')] });
    expect((await booking(b1)).start_epoch).toBe(at(start));
    expect(await value(b1)).toEqual({ value: 'b', version: 1 });
  });
});

describe('moveGroup with properties (HC-011B, visit)', () => {
  beforeEach(async () => {
    // b1 joins b2's visit so the container has two members sharing one window.
    await client.query('UPDATE sched_bookings SET metadata=$2::jsonb WHERE id=$1', [
      b1,
      JSON.stringify({ groupId: group, groupSeq: 0, groupLength: 60 }),
    ]);
    await client.query('UPDATE sched_bookings SET start_time=$2, end_time=$3 WHERE id=$1', [
      b2,
      start,
      end,
    ]);
  });

  it('success: every member moves and every member gets the value', async () => {
    const { moved } = await moveGroup(ctx, group, {
      ...later,
      properties: [write(b1, 'b'), write(b2, 'b')],
    });
    expect(moved).toBe(2);
    expect((await booking(b1)).start_epoch).toBe(at(later.start));
    expect((await booking(b2)).start_epoch).toBe(at(later.start));
    expect(await value(b1)).toEqual({ value: 'b', version: 1 });
    expect(await value(b2)).toEqual({ value: 'b', version: 1 });
  });

  it('one member stale → no member moves, no value row, including the member that would have passed', async () => {
    await putCustomPropertyValue(ctx, TABLE, prop, b2, 'a', 0);
    await expect(
      moveGroup(ctx, group, { ...later, properties: [write(b1, 'b', 0), write(b2, 'b', 0)] }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    expect((await booking(b1)).start_epoch).toBe(at(start));
    expect((await booking(b2)).start_epoch).toBe(at(start));
    expect(await value(b1)).toBeNull();
    expect(await value(b2)).toEqual({ value: 'a', version: 1 });
  });

  it('a write for a non-member is refused and nothing moves', async () => {
    await expect(
      moveGroup(ctx, group, { ...later, properties: [write(b1, 'b'), write(blocker, 'b')] }),
    ).rejects.toThrow('property record is not part of this booking');
    expect((await booking(b1)).start_epoch).toBe(at(start));
    expect(await value(b1)).toBeNull();
    expect(await value(blocker)).toBeNull();
  });

  it('move stage fails (conflict) → no value row for any member', async () => {
    await expect(
      moveGroup(ctx, group, { ...clash, properties: [write(b1, 'b'), write(b2, 'b')] }),
    ).rejects.toBeInstanceOf(BookingConflictError);
    expect(await value(b1)).toBeNull();
    expect(await value(b2)).toBeNull();
  });

  it('a CustomPropertyError carries its code out of the transaction', async () => {
    const e = await moveGroup(ctx, group, { ...later, properties: [write(b1, 'z')] }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(CustomPropertyError);
  });
});
