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
import type { CoreCtx } from '$server/auth/core-ctx';

const effects = vi.hoisted(() => ({ release: vi.fn(), realize: vi.fn(), audit: vi.fn() }));
vi.mock('$server/db/with-org-core', () => ({
  // Real PostgreSQL transaction/rollback; role/RLS has its own native fixture.
  withOrgCore: (ctx: CoreCtx, fn: Parameters<CoreCtx['db']['transaction']>[0]) =>
    ctx.db.transaction(fn),
}));
vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: vi.fn(),
  releaseAccruals: effects.release,
  realizeAccruals: effects.realize,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));
vi.mock('./activity.service', () => ({ recordAuditInTx: effects.audit }));
vi.mock('$server/auth/authorize', () => ({ requireAuth: () => ({ id: 'fixture-actor' }) }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => ctx }));
import { PATCH } from '../../routes/api/scheduling/bookings/[id]/+server';
import { patchBooking, updateBooking } from './scheduling-bookings.service';

const client = new PGlite();
const db = drizzle(client);
const ctx = { db: db as unknown as CoreCtx['db'], tenantId: 'fixture-org' };
const id = '10000000-0000-4000-8000-000000000001';
const resource = '20000000-0000-4000-8000-000000000001';
const replacement = '20000000-0000-4000-8000-000000000002';
const eventType = '30000000-0000-4000-8000-000000000001';
const missing = '40000000-0000-4000-8000-000000000001';
const start = new Date('2026-09-12T14:00:00Z');
const end = new Date('2026-09-12T15:00:00Z');
beforeAll(async () => {
  for (const table of [
    schedBookings,
    schedBookingStatusLog,
    schedEventTypes,
    schedResources,
    finInvoices,
    posPackageRedemptions,
  ]) {
    const config = getTableConfig(table);
    await client.exec(
      `CREATE TABLE "${config.name}" (${config.columns.map((c) => `"${c.name}" ${c.getSQLType()}`).join(',')})`,
    );
  }
});
afterAll(() => client.close());
beforeEach(async () => {
  vi.clearAllMocks();
  effects.audit.mockResolvedValue(undefined);
  effects.release.mockResolvedValue(0);
  await client.exec(
    'TRUNCATE sched_bookings, sched_booking_status_log, sched_resources, sched_event_types, fin_invoices, pos_package_redemptions',
  );
  await client.query(
    'INSERT INTO sched_bookings (id,org_id,uid,event_type_id,resource_id,start_time,end_time,status,title,metadata) VALUES ($1::uuid,$2,($1::uuid)::text,$3,$4,$5,$6,$7,$8,$9)',
    [id, ctx.tenantId, eventType, resource, start, end, 'accepted', 'Original', '{}'],
  );
  await client.query(
    'INSERT INTO sched_resources (id,org_id,active) VALUES ($1,$2,true),($3,$2,true)',
    [resource, ctx.tenantId, replacement],
  );
  await client.query(
    'INSERT INTO sched_event_types (id,org_id,before_buffer,after_buffer) VALUES ($1,$2,0,0)',
    [eventType, ctx.tenantId],
  );
});
async function row() {
  return (
    await client.query<{ resource_id: string; status: string; title: string; start_time: string }>(
      'SELECT resource_id,status,title,start_time::text FROM sched_bookings WHERE id=$1',
      [id],
    )
  ).rows[0];
}
describe('atomic booking changes', () => {
  it('rejects a compound PATCH without realizing stock or changing the booking', async () => {
    const before = await row();
    const request = new Request('https://fixture.invalid/api/scheduling/bookings/' + id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        start: '2026-09-12T16:00:00Z',
        end: '2026-09-12T17:00:00Z',
        status: 'completed',
        invoiceId: missing,
      }),
    });
    await expect(PATCH({ locals: {}, params: { id }, request } as never)).rejects.toMatchObject({
      status: 400,
    });
    expect(await row()).toEqual(before);
    expect(effects.realize).not.toHaveBeenCalled();
    expect(effects.release).not.toHaveBeenCalled();
  });
  it('rolls back reschedule and status when an invoice reference is rejected', async () => {
    const before = await row();
    await expect(
      patchBooking(ctx, id, {
        start: new Date('2026-09-12T16:00:00Z'),
        end: new Date('2026-09-12T17:00:00Z'),
        status: 'cancelled',
        invoiceId: missing,
      }),
    ).rejects.toThrow('invalid invoiceId');
    expect(await row()).toEqual(before);
    expect(effects.release).not.toHaveBeenCalled();
  });
  it('rolls back reassignment when the replacement service is invalid', async () => {
    const before = await row();
    await expect(
      updateBooking(ctx, id, { resourceId: replacement, eventTypeId: missing }),
    ).rejects.toThrow('invalid eventTypeId');
    expect(await row()).toEqual(before);
  });
  it('rolls back all edits when audit persistence fails', async () => {
    effects.audit.mockRejectedValueOnce(new Error('audit unavailable'));
    const before = await row();
    await expect(
      patchBooking(ctx, id, { resourceId: replacement, title: 'New title', status: 'cancelled' }),
    ).rejects.toThrow('audit unavailable');
    expect(await row()).toEqual(before);
    expect(effects.release).not.toHaveBeenCalled();
  });
  it('commits all fields before releasing stock accruals', async () => {
    effects.release.mockImplementationOnce(async () => {
      expect(await row()).toMatchObject({
        resource_id: replacement,
        title: 'New title',
        status: 'cancelled',
      });
      return 0;
    });
    const result = await patchBooking(ctx, id, {
      resourceId: replacement,
      title: 'New title',
      status: 'cancelled',
    });
    expect(result.status).toBe('cancelled');
    expect(effects.release).toHaveBeenCalledOnce();
  });
});
