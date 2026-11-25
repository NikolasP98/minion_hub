/**
 * Spec 116 slice 5 + spec 139 S1 — what the reply scan does with a client's answer.
 * A "no" never cancels: it opens a reconfirmation case and the booking keeps its status.
 * A reply for an appointment that closed after the scan selected it (the inference call
 * widens that window) is refused by the status owner; the job logs it and carries on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  setStatus: vi.fn<(ctx: unknown, id: string, status: string) => Promise<void>>(),
  infer: vi.fn(),
  openCase: vi.fn(),
  logVerdict: vi.fn(),
  lastInbound: vi.fn(),
  aged: vi.fn(),
  candidates: [] as unknown[],
  inbound: [] as unknown[],
  outbound: [] as unknown[],
  activity: 0,
  executed: [] as Array<{ text: string; params: unknown[] }>,
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
      // Route by statement text: candidates, inbound reads, outbound reads, CRM activity.
      execute: async (q: SQL) => {
        const { sql: text, params } = dialect.sqlToQuery(q);
        h.executed.push({ text, params });
        if (text.includes('insert into crm_activities')) h.activity += 1;
        if (text.includes('from sched_bookings b')) return h.candidates;
        if (text.includes("direction = 'inbound'")) return [...h.inbound].reverse(); // SQL is newest first
        if (text.includes("direction = 'outbound'")) return h.outbound;
        return [];
      },
    }),
}));
vi.mock('./scheduling-bookings.service', async (orig) => ({
  ...(await orig<object>()),
  setBookingStatus: (ctx: unknown, id: string, status: string) => h.setStatus(ctx, id, status),
}));

import { scanConfirmationReplies, attributeReplies } from './reminders.service';
import { BookingTransitionError } from './scheduling-bookings.service';

const ctx = { db: {} as never, tenantId: 'org-1' };
const NOW = new Date('2026-11-23T15:00:00Z');
const day = 86_400_000;
const REM_AT = new Date(NOW.getTime() - day).toISOString();

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
  stage: 'confirmation',
  rem_at: REM_AT,
  account_id: 'acct-1',
  ...over,
});
let msgN = 0;
const reply = (content: string, at = new Date(NOW.getTime() - 60_000), id?: string) => ({
  id: id ?? `m-${(msgN += 1)}`,
  content,
  occurred_at: at.toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  msgN = 0;
  h.executed = [];
  h.candidates = [];
  h.inbound = [];
  h.outbound = [];
  h.activity = 0;
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

const scan = (cands: unknown[], inbound: unknown[], outbound: unknown[] = []) => {
  h.candidates = cands;
  h.inbound = inbound;
  h.outbound = outbound;
  return scanConfirmationReplies(ctx, NOW);
};

describe('scanConfirmationReplies on a booking closed meanwhile', () => {
  it('skips the counter and the CRM activity for the refused one, and the batch continues', async () => {
    h.setStatus.mockImplementation(async (_c, id) => {
      if (id === 'b1') throw new BookingTransitionError('cancelled', 'accepted');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Two different people so each booking is its own group.
    const r = await scan([row('b1'), row('b2', { recipient: '+51911222333' })], [reply('si')]);
    // Both groups read the same fake inbound list, so both see the "si".
    expect(h.setStatus.mock.calls.map((c) => c[1])).toEqual(['b1', 'b2']);
    expect(r).toEqual({ confirmed: 1, opened: 0, unclear: 0 });
    expect(h.activity).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('any other failure on one booking is logged by name and the scan carries on', async () => {
    h.setStatus.mockImplementation(async (_c, id) => {
      if (id === 'b1') throw new Error('db down +51999888777');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await scan([row('b1'), row('b2', { recipient: '+51911222333' })], [reply('si')]);
    expect(r.confirmed).toBe(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).not.toContain('51999888777'); // message text never logged
  });

  it('an open case that vanished while opening does not stop the other bookings', async () => {
    h.openCase.mockRejectedValueOnce(new Error('reconfirm: open case vanished during insert'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await scan(
      [row('b1'), row('b2', { recipient: '+51911222333' })],
      [reply('no puedo')],
    );
    expect(h.openCase).toHaveBeenCalledTimes(2);
    expect(r.opened).toBe(1);
  });
});

describe('a "no" opens a case and never cancels', () => {
  it('opens one case, changes no status, and counts it', async () => {
    const r = await scan([row('b1')], [reply('no puedo')]);

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
    await scan([row('b1', { group_id: 'visit-9' })], [reply('no')]);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ bookingId: 'b1', subjectKey: 'visit-9' });
  });

  it('a second negation on the open case adds an event and counts no new case', async () => {
    h.openCase.mockResolvedValue({ caseId: 'case-1', created: false });
    const r = await scan([row('b1')], [reply('no puedo')]);
    expect(r.opened).toBe(0);
    expect(h.activity).toBe(0); // no CRM activity for a repeat
  });

  it('a reply after the start opens the case as late_reply', async () => {
    const start = new Date(NOW.getTime() - 3_600_000).toISOString();
    await scan([row('b1', { start_time: start })], [reply('no puedo', NOW)]);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ result: 'late_reply' });
  });

  it('an accepted booking is scanned too, and a "no" still opens a case', async () => {
    const r = await scan([row('b1', { status: 'accepted' })], [reply('no')]);
    expect(r.opened).toBe(1);
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it('"no voy a poder" on the keyword path opens a case (long clear negation)', async () => {
    const r = await scan([row('b1')], [reply('no voy a poder ir mañana')]);
    expect(r.opened).toBe(1);
  });

  it('every verdict path writes at most pending -> accepted, never a cancel', async () => {
    for (const msgs of [['sí', 'no, mejor no puedo'], ['no', 'sí'], ['cancelar'], ['👍']]) {
      h.setStatus.mockClear();
      await scan(
        [row('b1')],
        msgs.map((m) => reply(m)),
      );
      expect(h.setStatus.mock.calls.every((c) => c[2] === 'accepted')).toBe(true);
    }
  });
});

describe('a "sí"', () => {
  it('accepts a pending booking and logs the verdict', async () => {
    const r = await scan([row('b1')], [reply('sí')]);
    expect(r.confirmed).toBe(1);
    expect(h.setStatus).toHaveBeenCalledExactlyOnceWith(ctx, 'b1', 'accepted');
    expect(h.logVerdict).toHaveBeenCalledTimes(1);
    expect(h.openCase).not.toHaveBeenCalled();
  });

  it('a long yes with no negation token confirms (as master)', async () => {
    for (const t of ['Sí, confirmo mi cita', 'sí, gracias, ahí estaré']) {
      h.setStatus.mockClear();
      expect((await scan([row('b1')], [reply(t)])).confirmed).toBe(1);
    }
  });

  it('changes nothing on an accepted booking, but still logs it', async () => {
    const r = await scan([row('b1', { status: 'accepted' })], [reply('sí')]);
    expect(r).toEqual({ confirmed: 0, opened: 0, unclear: 0 });
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.logVerdict).toHaveBeenCalledTimes(1);
  });

  it('never confirms a booking that already started (a "no" for it still opens a late case)', async () => {
    const start = new Date(NOW.getTime() - 3_600_000).toISOString();
    const r = await scan([row('b1', { start_time: start })], [reply('sí', NOW)]);
    expect(r.confirmed).toBe(0);
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.logVerdict).toHaveBeenCalledTimes(1);
  });
});

describe('one reply hits one booking', () => {
  const later = (days: number) => new Date(NOW.getTime() + days * day).toISOString();

  it('two bookings, same phone, one "no puedo": exactly one case, on the nearest upcoming start', async () => {
    const r = await scan(
      [row('mon', { start_time: later(5) }), row('thu', { start_time: later(1) })],
      [reply('no puedo')],
    );
    expect(r.opened).toBe(1);
    expect(h.openCase).toHaveBeenCalledTimes(1);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ bookingId: 'thu' });
  });

  it('the reminder sent closest before the message wins over a nearer start', async () => {
    const r = await scan(
      [
        row('old', {
          start_time: later(1),
          rem_at: new Date(NOW.getTime() - 3 * day).toISOString(),
        }),
        row('new', {
          start_time: later(5),
          rem_at: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
        }),
      ],
      [reply('no puedo')],
    );
    expect(r.opened).toBe(1);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ bookingId: 'new' });
  });

  it('classifies once per group, not once per booking', async () => {
    h.config.inferConfirmation = true;
    h.infer.mockResolvedValue({ verdict: 'negation', confidence: 0.95, via: 'jev' });
    await scan(
      [
        row('a', { start_time: later(1) }),
        row('b', { start_time: later(2) }),
        row('c', { start_time: later(3) }),
      ],
      [reply('no puedo')],
    );
    expect(h.infer).toHaveBeenCalledTimes(1);
  });

  it('same phone, two clients: only the reminded booking is a candidate and gets the case', async () => {
    // The candidate query already requires a sent client reminder; the unreminded booking never appears.
    const r = await scan([row('reminded')], [reply('no puedo')]);
    expect(r.opened).toBe(1);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ bookingId: 'reminded' });
  });

  it('attributeReplies: a message before the reminder belongs to no booking', () => {
    const m = attributeReplies(
      [{ id: 'b', start_time: later(1), rem_at: new Date(NOW.getTime() - 1000).toISOString() }],
      [{ id: 'x', content: 'no', at: NOW.getTime() - 5000 }],
      [],
      NOW.getTime(),
    );
    expect(m.size).toBe(0);
  });
});

describe('only real replies count', () => {
  it('reads only one-to-one inbound messages', async () => {
    await scan([row('b1')], []);
    const read = h.executed.find((e) => e.text.includes("direction = 'inbound'"))!;
    expect(read.text).toContain('coalesce(is_group, false) = false');
  });

  it('a message after staff wrote in the chat is not a reply to the reminder', async () => {
    const staffAt = new Date(NOW.getTime() - 3_600_000);
    const r = await scan(
      [row('b1')],
      [reply('no puedo', new Date(NOW.getTime() - 60_000))],
      [{ occurred_at: staffAt.toISOString() }],
    );
    expect(r.opened).toBe(0);
    expect(h.openCase).not.toHaveBeenCalled();
  });

  it('the outbound read leaves out the reminders themselves', async () => {
    await scan([row('b1')], [reply('no')]);
    const out = h.executed.find((e) => e.text.includes("direction = 'outbound'"))!;
    expect(out.text).toContain("not in ('reminder','reconfirm')");
    expect(out.text).toContain('from sched_reconfirm_events e');
    expect(out.text).toContain('from sched_reminders x');
  });

  it('a reply before the staff message still counts', async () => {
    const r = await scan(
      [row('b1')],
      [reply('no puedo', new Date(NOW.getTime() - 3 * 3_600_000))],
      [{ occurred_at: new Date(NOW.getTime() - 3_600_000).toISOString() }],
    );
    expect(r.opened).toBe(1);
  });

  it('the unclear escalation only considers reminders that asked for an answer', async () => {
    await scan(
      [
        row('asked', { stage: 'confirmation' }),
        row('told', {
          stage: '24h',
          reminder_text: 'Te esperamos mañana',
          recipient: '+51911222333',
        }),
      ],
      [],
    );
    expect(h.aged.mock.calls[0]![1]).toEqual(['asked']);
  });
});

describe('confidence and cursor', () => {
  it('a low-confidence negation is logged as given and opens nothing', async () => {
    const r = await scan([row('b1')], [reply('no sé a qué hora es mi cita')]);
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
    expect((await scan([row('b1')], [reply('creo que no')])).unclear).toBe(1);

    h.infer.mockResolvedValueOnce({ verdict: 'negation', confidence: 0.9, via: 'jev' });
    expect((await scan([row('b2')], [reply('no voy a poder')])).opened).toBe(1);
    expect(h.infer.mock.calls[0]![1]).toMatchObject({ reminderText: 'Recordatorio' });
  });

  it('a read reply costs no classifier call; a later message with the same timestamp is still read', async () => {
    h.config.inferConfirmation = true;
    h.infer.mockResolvedValue({ verdict: 'yes', confidence: 0.99, via: 'jev' });
    const at = new Date('2026-11-23T14:30:00Z');
    h.lastInbound.mockResolvedValue(new Map([['b1', { at, id: 'm-5' }]]));

    await scan([row('b1')], [reply('si', at, 'm-5')]); // already classified
    expect(h.infer).not.toHaveBeenCalled();

    await scan([row('b1')], [reply('si', at, 'm-5'), reply('gracias', at, 'm-6')]); // equal timestamp, later id
    expect(h.infer).toHaveBeenCalledTimes(1);
    // the cursor now covers the newest message
    expect(h.logVerdict.mock.calls[0]![1]).toMatchObject({ inboundMessageId: 'm-6' });
  });

  it('shows the classifier the replies since the reminder (last 10), not only the new ones', async () => {
    h.config.inferConfirmation = true;
    h.infer.mockResolvedValue({ verdict: 'yes', confidence: 0.99, via: 'jev' });
    const t = (i: number) => new Date(NOW.getTime() - (20 - i) * 60_000);
    h.lastInbound.mockResolvedValue(new Map([['b1', { at: t(11), id: 'm-11' }]]));
    const msgs = Array.from({ length: 13 }, (_, i) => reply(`msg ${i}`, t(i + 1), `m-${i + 1}`));
    await scan([row('b1')], msgs);
    const texts = h.infer.mock.calls[0]![0] as string[];
    expect(texts).toHaveLength(10);
    expect(texts[9]).toBe('msg 12');
    expect(texts[0]).toBe('msg 3'); // includes ones older than the cursor
  });

  it('reads the account the reminder was sent with, and falls back to the config for legacy rows', async () => {
    await scan([row('b1', { account_id: 'acct-9' })], []);
    let read = h.executed.find((e) => e.text.includes("direction = 'inbound'"))!;
    expect(read.text).toContain('account_id =');
    expect(read.params).toContain('acct-9');
    expect(read.params).not.toContain('acct-1');

    h.executed = [];
    await scan([row('b1', { account_id: null })], []);
    read = h.executed.find((e) => e.text.includes("direction = 'inbound'"))!;
    expect(read.params).toContain('acct-1');
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
    const r = await scan([row('b1')], []);

    expect(r.opened).toBe(1);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ bookingId: 'b1', result: 'unclear' });
    // The cut-off handed to the query is now minus the configured wait.
    expect((h.aged.mock.calls[0]![2] as Date).toISOString()).toBe('2026-11-22T15:00:00.000Z');
  });
});
