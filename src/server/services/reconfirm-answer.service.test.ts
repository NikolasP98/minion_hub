import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const h = vi.hoisted(() => {
  class SlotUnavailableError extends Error {}
  class BookingConflictError extends Error {}
  class AssistantRescheduleError extends Error {}
  return {
    tx: null as unknown,
    infer: vi.fn(),
    send: vi.fn(),
    slots: vi.fn(),
    move: vi.fn(),
    setStatus: vi.fn(),
    allows: vi.fn(),
    config: {} as Record<string, unknown>,
    SlotUnavailableError,
    BookingConflictError,
    AssistantRescheduleError,
  };
});
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_c: unknown, fn: (tx: unknown) => unknown) => fn(h.tx),
}));
vi.mock('./scheduling-bookings.service', () => ({
  SlotUnavailableError: h.SlotUnavailableError,
  BookingConflictError: h.BookingConflictError,
  AssistantRescheduleError: h.AssistantRescheduleError,
  rescheduleAssistantBookingInTx: h.move,
  setBookingStatusInTx: h.setStatus,
}));
vi.mock('./scheduling-slots.service', () => ({ getSlotsForEventType: h.slots }));
vi.mock('./reminder-config.service', () => ({ getReminderConfig: async () => h.config }));
vi.mock('./entitlements.service', () => ({ orgAllows: h.allows }));
vi.mock('./reconfirm.service', () => ({ sendAgentMessage: h.send }));
vi.mock('./reminder-compose', async (orig) => ({
  ...(await orig<object>()),
  inferReconfirmAnswer: h.infer,
}));

import { acceptOfferedSlot, advanceAnswers } from './reconfirm-answer.service';

const dialect = new PgDialect();
const ctx = { db: {} as never, tenantId: 'org-1' };
const NOW = new Date('2026-11-25T15:00:00Z'); // Wednesday, 10:00 Lima
const START = '2026-11-27T22:15:00.000Z';

const caseRow = (over: Record<string, unknown> = {}) => ({
  id: 'case-1',
  booking_id: 'b1',
  agent_state: 'asking',
  channel: 'whatsapp',
  account_id: 'acct',
  recipient: '+51999000111',
  opened_at: '2026-11-25T14:00:00Z',
  offered_slots: [],
  since: '2026-11-25T14:30:00Z',
  start_time: START,
  status: 'pending',
  group_id: null,
  event_type_id: 'et1',
  resource_id: 'res1',
  updated_at: '2026-11-25T13:00:00.000Z',
  attendee_name: 'Ana',
  service_title: 'Botox',
  staff_name: 'Dra. Renzo',
  timezone: 'America/Lima',
  agent_text: 'Hola Ana…',
  ...over,
});
const slot = (iso: string) => ({
  start: new Date(iso),
  end: new Date(Date.parse(iso) + 1_800_000),
  resourceIds: ['res1'],
});
const answer = (over: Record<string, unknown> = {}) => ({
  verdict: 'other_date',
  confidence: 0.95,
  via: 'jev',
  pick: null,
  day: 'mon',
  partOfDay: 'afternoon',
  ...over,
});

let open: unknown[];
let replies: unknown[];
let offerRow: Record<string, unknown> | null;
let log: Array<{ text: string; params: unknown[] }>;
beforeEach(() => {
  vi.clearAllMocks();
  open = [caseRow()];
  replies = [{ content: 'el lunes en la tarde', occurred_at: '2026-11-25T14:45:00Z' }];
  offerRow = null;
  log = [];
  h.config = {
    enabled: true,
    inferConfirmation: true,
    locale: 'es',
    fromName: 'FACES',
    negationWaitHours: 24,
    stages: [{ key: 'confirmation' }, { key: '24h', minutesBefore: 1440 }],
  };
  h.allows.mockResolvedValue(true);
  h.send.mockResolvedValue('sent');
  h.infer.mockResolvedValue(answer());
  h.slots.mockResolvedValue({
    slots: [slot('2026-11-30T21:00:00Z'), slot('2026-11-30T22:30:00Z')],
  });
  h.move.mockResolvedValue({ booking: { status: 'pending' }, outcome: 'moved' });
  h.setStatus.mockResolvedValue(undefined);
  h.tx = {
    execute: async (q: SQL) => {
      const { sql: raw, params } = dialect.sqlToQuery(q);
      const text = raw.replace(/\s+/g, ' ').trim();
      log.push({ text, params });
      if (text.includes('from sched_reconfirm_cases c join sched_bookings')) return open;
      if (text.includes("direction = 'inbound'")) return replies;
      if (text.includes('select booking_id, offered_slots')) return offerRow ? [offerRow] : [];
      if (text.includes('update sched_reconfirm_cases') && text.includes('set result ='))
        return [{ id: 'case-1' }];
      return [];
    },
  };
});
const stmts = (n: string) => log.filter((s) => s.text.includes(n));
const closings = () => h.send.mock.calls.filter((c) => c[2] === 'closing');

describe('advanceAnswers: the offer', () => {
  it('offers up to three free times of the same service, pinned to the same staff member, ignoring the booking itself', async () => {
    const r = await advanceAnswers(ctx, NOW);
    expect(r).toMatchObject({ answered: 1, offered: 1 });
    const [, eventTypeId, from, to, opts] = h.slots.mock.calls[0]!;
    expect(eventTypeId).toBe('et1');
    expect(opts).toMatchObject({ pinnedResourceId: 'res1', excludeBookingId: 'b1' });
    expect((from as Date).toISOString()).toBe('2026-11-30T05:00:00.000Z'); // Monday 00:00 Lima
    expect((to as Date).toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]![2]).toBe('offer');
    expect(h.send.mock.calls[0]![3]).toBe(
      'Tenemos estos horarios con Dra. Renzo: 1) lun 30/11 16:00 2) lun 30/11 17:30. Responde con el número del que prefieras.',
    );
  });

  it('no day or part of day named, or a grouped visit: wants_other_date and a closing, no offer', async () => {
    h.infer.mockResolvedValue(answer({ day: null, partOfDay: null }));
    await advanceAnswers(ctx, NOW);
    expect(h.slots).not.toHaveBeenCalled();
    expect(stmts('set result =')[0]!.params).toContain('wants_other_date');
    expect(closings()).toHaveLength(1);
    vi.clearAllMocks();
    h.infer.mockResolvedValue(answer());
    h.send.mockResolvedValue('sent');
    open = [caseRow({ group_id: 'g1' })];
    await advanceAnswers(ctx, NOW);
    expect(h.slots).not.toHaveBeenCalled();
    expect(h.send.mock.calls.map((c) => c[2])).toEqual(['closing']);
  });

  it('a low-confidence answer is unclear: nothing is offered and the reply is not read again', async () => {
    h.infer.mockResolvedValue(answer({ confidence: 0.5 }));
    await advanceAnswers(ctx, NOW);
    expect(h.send).not.toHaveBeenCalled();
    expect(stmts('set last_inbound_at')).toHaveLength(1);
  });
});

describe('advanceAnswers: the pick', () => {
  const offered = [
    { start: '2026-11-30T21:00:00.000Z', resourceId: 'res1' },
    { start: '2026-11-30T22:30:00.000Z', resourceId: 'res1' },
  ];
  beforeEach(() => {
    open = [caseRow({ agent_state: 'offered', offered_slots: offered })];
    replies = [{ content: '2', occurred_at: '2026-11-25T15:30:00Z' }];
    h.infer.mockResolvedValue(answer({ verdict: 'pick', pick: 1, day: null, partOfDay: null }));
    offerRow = {
      booking_id: 'b1',
      offered_slots: offered,
      offer_booking_updated_at: '2026-11-25T13:00:00.000Z',
    };
  });

  it('a sure pick moves the booking, accepts it, clears time-based reminders and closes the case, then confirms', async () => {
    const r = await advanceAnswers(ctx, NOW);
    expect(r).toMatchObject({ rescheduled: 1 });
    const [, , bookingId, input] = h.move.mock.calls[0]!;
    expect(bookingId).toBe('b1');
    expect((input.start as Date).toISOString()).toBe('2026-11-30T22:30:00.000Z');
    expect(input).toMatchObject({ resourceId: 'res1' });
    expect((input.expectedUpdatedAt as Date).toISOString()).toBe('2026-11-25T13:00:00.000Z');
    expect(h.setStatus.mock.calls[0]!.slice(2, 4)).toEqual(['b1', 'accepted']);
    const del = stmts('delete from sched_reminders')[0]!;
    expect(del.text).toContain("recipient_role = 'client'");
    expect(del.params).toContain('24h');
    expect(del.params).not.toContain('confirmation');
    expect(stmts("result = 'rescheduled'")).toHaveLength(1);
    expect(h.send.mock.calls.map((c) => c[2])).toEqual(['confirm']);
    expect(h.send.mock.calls[0]![3]).toBe(
      'Listo, tu cita de Botox quedó para el lunes 30/11 a las 17:30. ¡Te esperamos!',
    );
  });

  it('a conflict inside the transaction moves nothing and ends as wants_other_date', async () => {
    h.move.mockRejectedValue(new h.BookingConflictError('taken'));
    await advanceAnswers(ctx, NOW);
    expect(stmts("result = 'rescheduled'")).toHaveLength(0);
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(stmts('delete from sched_reminders')).toHaveLength(0);
    expect(stmts('set result =')[0]!.params).toContain('wants_other_date');
    expect(closings()).toHaveLength(1);
  });

  it('a pick below the confidence floor, or of nothing offered, moves nothing', async () => {
    h.infer.mockResolvedValue(answer({ verdict: 'pick', pick: 1, confidence: 0.6 }));
    await advanceAnswers(ctx, NOW);
    expect(h.move).not.toHaveBeenCalled();
    expect(stmts('set result =')[0]!.params).toContain('wants_other_date'); // one offer round only
    vi.clearAllMocks();
    h.send.mockResolvedValue('sent');
    h.infer.mockResolvedValue(answer({ verdict: 'pick', pick: 5 }));
    await advanceAnswers(ctx, NOW);
    expect(h.move).not.toHaveBeenCalled();
  });

  it('any other reply after the offer goes to staff as wants_other_date', async () => {
    h.infer.mockResolvedValue(answer({ verdict: 'other_date' }));
    await advanceAnswers(ctx, NOW);
    expect(h.move).not.toHaveBeenCalled();
    expect(stmts('set result =')[0]!.params).toContain('wants_other_date');
  });

  it('acceptOfferedSlot answers slot_taken for a case that is no longer offered', async () => {
    offerRow = null;
    expect(await acceptOfferedSlot(ctx, 'case-1', 0, NOW)).toBe('slot_taken');
    expect(h.move).not.toHaveBeenCalled();
  });
});

describe('advanceAnswers: the other outcomes', () => {
  it('decline: declined stays with staff, closing sent, booking untouched', async () => {
    h.infer.mockResolvedValue(answer({ verdict: 'decline' }));
    await advanceAnswers(ctx, NOW);
    expect(stmts('set result =')[0]!.params).toContain('declined');
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
    expect(closings()).toHaveLength(1);
  });

  it('will_come: a pending booking becomes accepted and the case closes at once', async () => {
    h.infer.mockResolvedValue(answer({ verdict: 'will_come' }));
    await advanceAnswers(ctx, NOW);
    expect(h.setStatus.mock.calls[0]!.slice(2, 4)).toEqual(['b1', 'accepted']);
    expect(stmts('set result =')[0]!.params).toContain('will_come');
    expect(stmts('set result =')[0]!.text).toContain('close_action');
  });

  it('an org without ai.proactive (or with AI reading off) never calls the classifier', async () => {
    h.allows.mockResolvedValue(false);
    expect(await advanceAnswers(ctx, NOW)).toEqual({ answered: 0, offered: 0, rescheduled: 0 });
    h.allows.mockResolvedValue(true);
    h.config = { ...h.config, inferConfirmation: false };
    await advanceAnswers(ctx, NOW);
    expect(h.infer).not.toHaveBeenCalled();
  });

  it('no new reply: nothing is classified', async () => {
    replies = [];
    await advanceAnswers(ctx, NOW);
    expect(h.infer).not.toHaveBeenCalled();
  });
});

describe('invariant: the agent never cancels', () => {
  it('imports no cancel/release/redeem path; booking writes are only the move and pending->accepted', () => {
    const src = readFileSync(new URL('./reconfirm-answer.service.ts', import.meta.url), 'utf8');
    const imports = src
      .split('\n')
      .filter((l) => /^import |^  \w+,$|from '/.test(l))
      .join('\n');
    expect(imports).not.toMatch(/cancel|release|redeem|refund|stock|package/i);
    expect(src).not.toMatch(
      /setBookingStatus(InTx)?\([^)]*'(cancelled|rejected|no_show|completed)'/,
    );
    expect(src).not.toMatch(/update sched_bookings/i);
    expect(src).not.toMatch(/console\.(log|warn|info)/);
  });
});
