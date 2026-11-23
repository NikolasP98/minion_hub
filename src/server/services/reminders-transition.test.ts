/**
 * Spec 116 slice 5 + spec 139 S1 — what the reply scan does with a client's answer.
 * A "no" never cancels: it opens a reconfirmation case and the booking keeps its status.
 * A reply for an appointment that closed after the scan selected it (the inference call
 * widens that window) is refused by the status owner; the job logs it and carries on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const h = vi.hoisted(() => ({
  setStatus: vi.fn<(ctx: unknown, id: string, status: string) => Promise<void>>(),
  infer: vi.fn(),
  openCase: vi.fn(),
  logVerdict: vi.fn(),
  lastInbound: vi.fn(),
  aged: vi.fn(),
  txResults: [] as unknown[],
  executed: [] as unknown[],
  config: {} as Record<string, unknown>,
}));

vi.mock('./reminder-config.service', () => ({
  getReminderConfig: async () => h.config,
  effectiveChannels: () => [{ channel: 'whatsapp', accountId: 'acct-1' }],
}));
vi.mock('./entitlements.service', () => ({ orgAllows: async () => true }));
vi.mock('./reminder-compose', () => ({
  composeReminder: async () => 'text',
  inferConfirmationReply: (...a: unknown[]) => h.infer(...a),
}));
vi.mock('./reconfirm.service', () => ({
  openCase: (...a: unknown[]) => h.openCase(...a),
  logVerdict: (...a: unknown[]) => h.logVerdict(...a),
  lastInboundAt: (...a: unknown[]) => h.lastInbound(...a),
  agedUnclearVerdicts: (...a: unknown[]) => h.aged(...a),
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

const dialect = new PgDialect();
const ctx = { db: {} as never, tenantId: 'org-1' };
const NOW = new Date('2026-11-23T15:00:00Z');
const day = 86_400_000;

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  start_time: new Date(NOW.getTime() + day).toISOString(),
  status: 'pending',
  attendee_name: 'Ana',
  crm_contact_id: `contact-${id}`,
  group_id: null,
  service_title: 'Botox',
  timezone: 'America/Lima',
  channel: 'whatsapp',
  recipient: '+51999888777',
  reminder_text: 'Recordatorio',
  since: new Date(NOW.getTime() - day).toISOString(),
  ...over,
});
const reply = (content: string, at = new Date(NOW.getTime() - 60_000)) => ({
  content,
  occurred_at: at.toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.executed = [];
  h.txResults = [];
  h.config = {
    enabled: true,
    inferConfirmation: false,
    personalize: false,
    locale: 'es',
    negationWaitHours: 24,
  };
  h.lastInbound.mockResolvedValue(new Map());
  h.aged.mockResolvedValue([]);
  h.openCase.mockResolvedValue({ caseId: 'case-1', created: true });
  h.setStatus.mockResolvedValue(undefined);
});

describe('scanConfirmationReplies on a booking closed meanwhile', () => {
  it('skips the counter and the CRM activity for the refused one, and the batch continues', async () => {
    h.txResults = [
      [row('b1'), row('b2')], // candidates
      [reply('si')], // b1 replies
      [reply('si')], // b2 replies
      [], // b2 CRM activity insert
    ];
    h.setStatus.mockImplementation(async (_c, id) => {
      if (id === 'b1') throw new BookingTransitionError('cancelled', 'accepted');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await scanConfirmationReplies(ctx, NOW);

    expect(h.setStatus.mock.calls.map((c) => c[1])).toEqual(['b1', 'b2']);
    expect(r).toEqual({ confirmed: 1, opened: 0, unclear: 0 });
    // candidates + two message reads + ONE activity insert (b2's).
    expect(h.executed).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('any other failure still propagates', async () => {
    h.txResults = [[row('b1')], [reply('si')]];
    h.setStatus.mockRejectedValue(new Error('db down'));

    await expect(scanConfirmationReplies(ctx, NOW)).rejects.toThrow('db down');
  });
});

describe('a "no" opens a case and never cancels', () => {
  it('opens one case, changes no status, and counts it', async () => {
    h.txResults = [[row('b1')], [reply('no puedo')], []];
    const r = await scanConfirmationReplies(ctx, NOW);

    expect(r).toEqual({ confirmed: 0, opened: 1, unclear: 0 });
    expect(h.openCase).toHaveBeenCalledTimes(1);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({
      bookingId: 'b1',
      subjectKey: 'b1',
      channel: 'whatsapp',
      accountId: 'acct-1',
      recipient: '+51999888777',
      result: null,
    });
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.logVerdict).not.toHaveBeenCalled(); // openCase writes the verdict event itself
  });

  it('a merged visit uses its groupId as the case subject', async () => {
    h.txResults = [[row('b1', { group_id: 'visit-9' })], [reply('no')], []];
    await scanConfirmationReplies(ctx, NOW);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ bookingId: 'b1', subjectKey: 'visit-9' });
  });

  it('a second negation on the open case adds an event and counts no new case', async () => {
    h.openCase.mockResolvedValue({ caseId: 'case-1', created: false });
    h.txResults = [[row('b1')], [reply('no puedo')]];
    const r = await scanConfirmationReplies(ctx, NOW);
    expect(r.opened).toBe(0);
    expect(h.executed).toHaveLength(2); // no CRM activity for a repeat
  });

  it('a reply after the start opens the case as late_reply', async () => {
    const start = new Date(NOW.getTime() - 3_600_000).toISOString();
    h.txResults = [[row('b1', { start_time: start })], [reply('no puedo', NOW)], []];
    await scanConfirmationReplies(ctx, NOW);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ result: 'late_reply' });
  });

  it('an accepted booking is scanned too, and a "no" still opens a case', async () => {
    h.txResults = [[row('b1', { status: 'accepted' })], [reply('no')], []];
    const r = await scanConfirmationReplies(ctx, NOW);
    expect(r.opened).toBe(1);
    expect(h.setStatus).not.toHaveBeenCalled();
  });
});

describe('a "sí"', () => {
  it('accepts a pending booking and logs the verdict', async () => {
    h.txResults = [[row('b1')], [reply('sí')], []];
    const r = await scanConfirmationReplies(ctx, NOW);
    expect(r.confirmed).toBe(1);
    expect(h.setStatus).toHaveBeenCalledExactlyOnceWith(ctx, 'b1', 'accepted');
    expect(h.logVerdict).toHaveBeenCalledTimes(1);
    expect(h.openCase).not.toHaveBeenCalled();
  });

  it('changes nothing on an accepted booking, but still logs it', async () => {
    h.txResults = [[row('b1', { status: 'accepted' })], [reply('sí')]];
    const r = await scanConfirmationReplies(ctx, NOW);
    expect(r).toEqual({ confirmed: 0, opened: 0, unclear: 0 });
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.logVerdict).toHaveBeenCalledTimes(1);
  });
});

describe('confidence and cursor', () => {
  it('a low-confidence negation is logged as given and opens nothing', async () => {
    h.txResults = [[row('b1')], [reply('no sé a qué hora es mi cita')]];
    const r = await scanConfirmationReplies(ctx, NOW);
    expect(r).toEqual({ confirmed: 0, opened: 0, unclear: 1 });
    expect(h.openCase).not.toHaveBeenCalled();
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.logVerdict.mock.calls[0]![1].verdict).toMatchObject({
      verdict: 'negation',
      confidence: 0.5,
    });
  });

  it('the model path acts on its confidence floor: 0.74 is unclear, 0.9 opens a case', async () => {
    h.config.inferConfirmation = true;
    h.infer.mockResolvedValueOnce({ verdict: 'negation', confidence: 0.74, via: 'jev' });
    h.txResults = [[row('b1')], [reply('creo que no')]];
    expect((await scanConfirmationReplies(ctx, NOW)).unclear).toBe(1);

    h.infer.mockResolvedValueOnce({ verdict: 'negation', confidence: 0.9, via: 'jev' });
    h.txResults = [[row('b2')], [reply('no voy a poder')], []];
    expect((await scanConfirmationReplies(ctx, NOW)).opened).toBe(1);
    expect(h.infer.mock.calls[0]![1]).toMatchObject({ reminderText: 'Recordatorio' });
  });

  it('reads only messages newer than the last logged verdict, so a read reply costs no classifier call', async () => {
    h.config.inferConfirmation = true;
    const cursor = new Date('2026-11-23T14:30:00Z');
    h.lastInbound.mockResolvedValue(new Map([['b1', cursor]]));
    h.txResults = [[row('b1')], []]; // nothing newer than the cursor
    await scanConfirmationReplies(ctx, NOW);

    expect(h.infer).not.toHaveBeenCalled();
    const { sql, params } = dialect.sqlToQuery(h.executed[1] as SQL);
    expect(sql).toContain('occurred_at >');
    expect(params).toContain(cursor.toISOString());
  });

  it('reads only the account the reminder used', async () => {
    h.txResults = [[row('b1')], []];
    await scanConfirmationReplies(ctx, NOW);
    const { sql, params } = dialect.sqlToQuery(h.executed[1] as SQL);
    expect(sql).toContain('account_id =');
    expect(params).toContain('acct-1');
  });

  it('an unclear answer older than the wait time opens a case with result unclear', async () => {
    h.aged.mockResolvedValue([
      {
        bookingId: 'b1',
        verdict: { verdict: 'unclear', confidence: 0, via: 'jev' },
        texts: ['mmm'],
        inboundAt: new Date(NOW.getTime() - 2 * day),
      },
    ]);
    h.txResults = [[row('b1')], []];
    const r = await scanConfirmationReplies(ctx, NOW);

    expect(r.opened).toBe(1);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ bookingId: 'b1', result: 'unclear' });
    // The cut-off handed to the query is now minus the configured wait.
    expect((h.aged.mock.calls[0]![2] as Date).toISOString()).toBe('2026-11-22T15:00:00.000Z');
  });
});
