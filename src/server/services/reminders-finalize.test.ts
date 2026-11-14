import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * The final write of a claimed reminder must only touch a row still `sending`:
 * a row the stale-send sweep already failed stays failed (spec 118 FR-005),
 * instead of tripping the transition trigger and aborting the org's tick.
 */
const h = vi.hoisted(() => ({ wheres: [] as unknown[], sets: [] as unknown[] }));
const booking = {
  id: 'b1',
  start_time: '2026-11-20T15:00:00.000Z',
  created_at: '2026-11-14T10:00:00.000Z',
  status: 'accepted',
  attendee_name: 'Ana',
  attendee_phone: '+51900000118',
  attendee_email: null,
  crm_contact_id: null,
  service_title: 'Consulta',
  staff_name: 'Dra.',
  staff_email: null,
  timezone: 'America/Lima',
  opt_out: '',
};
const tx = {
  execute: async () => [booking],
  select: () => ({ from: () => ({ where: async () => [] }) }),
  insert: () => ({
    values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: 'rem-1' }] }) }),
  }),
  update: () => ({
    set: (v: unknown) => ({
      where: async (w: unknown) => {
        h.sets.push(v);
        h.wheres.push(w);
        return [];
      },
    }),
  }),
};
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
}));
vi.mock('./reminder-config.service', () => ({
  getReminderConfig: async () => ({
    enabled: true,
    stages: [{ key: '24h', enabled: true, recipients: 'client' }],
    personalize: false,
    inferConfirmation: false,
    locale: 'es',
    fromName: 'FACES',
  }),
  effectiveChannels: () => [{ channel: 'whatsapp', accountId: null }],
}));
vi.mock('./entitlements.service', () => ({ orgAllows: async () => false }));
vi.mock('$server/scheduling/reminders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$server/scheduling/reminders')>()),
  dueStages: () => [{ key: '24h', enabled: true, recipients: 'client' }],
}));
vi.mock('./reminder-compose', () => ({
  composeReminder: async () => 'Recordatorio',
  inferConfirmationReply: vi.fn(),
}));
vi.mock('./scheduling-bookings.service', () => ({ setBookingStatus: vi.fn() }));
const gatewayCall = vi.fn();
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: (...a: unknown[]) => gatewayCall(...a) }));
vi.mock('./messages.service', () => ({ insertMessages: async () => undefined }));

import { processOrgReminders } from './reminders.service';

const dialect = new PgDialect();
const ctx = { tenantId: 'org-1' } as never;

beforeEach(() => {
  h.wheres = [];
  h.sets = [];
  gatewayCall.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function finalWhere(): { sql: string; params: unknown[] } {
  expect(h.wheres).toHaveLength(1);
  return dialect.sqlToQuery(h.wheres[0] as SQL);
}

describe('processOrgReminders final write', () => {
  it('a sent reminder is finalised only while the row is still sending', async () => {
    gatewayCall.mockResolvedValue({ messageId: 'm1' });
    const r = await processOrgReminders(ctx, new Date('2026-11-19T15:00:00.000Z'));
    expect(r.sent).toBe(1);
    expect(h.sets[0]).toMatchObject({ status: 'sent' });
    const { sql, params } = finalWhere();
    expect(sql).toContain('"sched_reminders"."status" = $');
    expect(params).toContain('sending');
  });

  it('a failed send is finalised only while the row is still sending', async () => {
    gatewayCall.mockRejectedValue(new Error('gateway down'));
    const r = await processOrgReminders(ctx, new Date('2026-11-19T15:00:00.000Z'));
    expect(r.failed).toBe(1);
    expect(h.sets[0]).toMatchObject({ status: 'failed' });
    expect(finalWhere().params).toContain('sending');
  });
});
