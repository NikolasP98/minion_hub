/**
 * Spec 139 S1 round 2 — the reply scan reads the NEWEST replies and only a NEW message can open
 * a case (never an old one after staff closed it). A reply never cancels.
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

import { scanConfirmationReplies } from './reminders.service';

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

describe('reply scan follow-up', () => {
  it('reads the newest 50 messages (desc in SQL) and classifies the latest', async () => {
    const msgs = Array.from({ length: 60 }, (_, i) =>
      reply(
        i === 59 ? 'no puedo' : 'hola',
        new Date(NOW.getTime() - (60 - i) * 1000),
        `m${String(i).padStart(2, '0')}`,
      ),
    );
    // The mock returns what the SQL would: newest 50, descending.
    const newest50 = msgs.slice(10);
    await scan([row('b1')], newest50);
    const q = h.executed.find((e) => e.text.includes("direction = 'inbound'"))!;
    expect(q.text).toMatch(/order by occurred_at desc, id desc\s+limit 50/);
    expect(h.openCase).toHaveBeenCalledTimes(1);
    expect(h.openCase.mock.calls[0]![1]).toMatchObject({ inboundMessageId: 'm59' });
  });

  it('puts the cursor in the inbound SQL when every booking has one', async () => {
    const at = new Date(NOW.getTime() - 3_600_000);
    h.lastInbound.mockResolvedValue(new Map([['b1', { at, id: 'm0', closedAt: null }]]));
    await scan([row('b1')], [reply('no puedo')]);
    const q = h.executed.find((e) => e.text.includes("direction = 'inbound'"))!;
    expect(q.params).toContain(at.toISOString());
  });

  it('a client "gracias" after staff closed the case opens nothing', async () => {
    const closedAt = new Date(NOW.getTime() - 3_600_000);
    h.lastInbound.mockResolvedValue(
      new Map([['b1', { at: new Date(closedAt.getTime() - 60_000), id: 'm1', closedAt }]]),
    );
    await scan(
      [row('b1')],
      [
        reply('no puedo', new Date(closedAt.getTime() - 60_000), 'm1'),
        reply('gracias', new Date(NOW.getTime() - 60_000), 'm2'),
      ],
    );
    expect(h.openCase).not.toHaveBeenCalled();
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it('a NEW "no puedo" after the close opens a new case', async () => {
    const closedAt = new Date(NOW.getTime() - 3_600_000);
    h.lastInbound.mockResolvedValue(
      new Map([['b1', { at: new Date(closedAt.getTime() - 60_000), id: 'm1', closedAt }]]),
    );
    await scan(
      [row('b1')],
      [
        reply('no puedo', new Date(closedAt.getTime() - 60_000), 'm1'),
        reply('no puedo ir', new Date(NOW.getTime() - 60_000), 'm2'),
      ],
    );
    expect(h.openCase).toHaveBeenCalledTimes(1);
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it('the AI path marks which messages are new', async () => {
    h.config.inferConfirmation = true;
    h.infer.mockResolvedValue({ verdict: 'unclear', confidence: 0.9, via: 'jev' });
    const closedAt = new Date(NOW.getTime() - 3_600_000);
    h.lastInbound.mockResolvedValue(
      new Map([['b1', { at: new Date(closedAt.getTime() - 60_000), id: 'm1', closedAt }]]),
    );
    await scan(
      [row('b1')],
      [
        reply('no puedo', new Date(closedAt.getTime() - 60_000), 'm1'),
        reply('gracias', new Date(NOW.getTime() - 60_000), 'm2'),
      ],
    );
    expect(h.infer.mock.calls[0]![0]).toEqual(['no puedo', 'gracias']);
    expect(h.infer.mock.calls[0]![1]).toMatchObject({ newCount: 1 });
  });

  it('the staff-outbound cut-off excludes our own reminders of ANY booking', async () => {
    await scan([row('b1')], [reply('si')]);
    const q = h.executed.find((e) => e.text.includes("direction = 'outbound'"))!;
    expect(q.text).not.toMatch(/x\.booking_id/);
    expect(q.text).toContain('sched_reminders x');
  });
});
