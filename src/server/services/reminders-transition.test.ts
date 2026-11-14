/**
 * Spec 116 slice 5 — a reminder reply for an appointment that closed after the
 * scan selected it (the inference call widens that window) is refused by the
 * status owner. The job logs it, records no counter and no CRM activity, and
 * carries on with the rest of the batch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  setStatus: vi.fn<(ctx: unknown, id: string, status: string) => Promise<void>>(),
  txResults: [] as unknown[],
  executed: [] as unknown[],
}));

vi.mock('./reminder-config.service', () => ({
  getReminderConfig: async () => ({
    enabled: true,
    inferConfirmation: false,
    personalize: false,
    locale: 'es',
  }),
  effectiveChannels: () => ['whatsapp'],
}));
vi.mock('./entitlements.service', () => ({ orgAllows: async () => true }));
vi.mock('./reminder-compose', () => ({
  composeReminder: async () => 'text',
  inferConfirmationReply: async () => 'unclear',
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (q: unknown) => {
        h.executed.push(q);
        return h.txResults.shift() ?? [];
      },
    }),
}));
vi.mock('./scheduling-bookings.service', async (orig) => ({
  ...(await orig<object>()),
  setBookingStatus: (ctx: unknown, id: string, status: string) => h.setStatus(ctx, id, status),
}));

import { scanConfirmationReplies } from './reminders.service';
import { BookingTransitionError } from './scheduling-bookings.service';

const ctx = { db: {} as never, tenantId: 'org-1' };
const row = (id: string) => ({
  id,
  start_time: new Date(Date.now() + 86_400_000).toISOString(),
  attendee_phone: '+51999888777',
  attendee_name: 'Ana',
  crm_contact_id: `contact-${id}`,
  service_title: 'Botox',
  timezone: 'America/Lima',
  confirm_sent_at: new Date().toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.executed = [];
});

describe('scanConfirmationReplies on a booking closed meanwhile', () => {
  it('skips the counter and the CRM activity for the refused one, and the batch continues', async () => {
    h.txResults = [
      [row('b1'), row('b2')], // pending candidates
      [{ content: 'si' }], // b1 replies
      [{ content: 'si' }], // b2 replies
      [], // b2 CRM activity insert
    ];
    h.setStatus.mockImplementation(async (_c, id) => {
      if (id === 'b1') throw new BookingTransitionError('cancelled', 'accepted');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await scanConfirmationReplies(ctx, new Date());

    expect(h.setStatus.mock.calls.map((c) => c[1])).toEqual(['b1', 'b2']);
    expect(r).toEqual({ confirmed: 1, declined: 0 });
    // candidates + two message reads + ONE activity insert (b2's).
    expect(h.executed).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('any other failure still propagates', async () => {
    h.txResults = [[row('b1')], [{ content: 'si' }]];
    h.setStatus.mockRejectedValue(new Error('db down'));

    await expect(scanConfirmationReplies(ctx, new Date())).rejects.toThrow('db down');
  });
});
