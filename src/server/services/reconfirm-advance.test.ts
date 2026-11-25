import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/** advanceCases against a statement-routing fake Postgres and a mocked gateway (spec 139 S2). */
const h = vi.hoisted(() => ({
  tx: null as unknown,
  gateway: vi.fn(),
  insertMessages: vi.fn(),
  config: {} as Record<string, unknown>,
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(h.tx),
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: h.gateway }));
vi.mock('./messages.service', () => ({ insertMessages: h.insertMessages }));
vi.mock('./reminder-config.service', () => ({ getReminderConfig: async () => h.config }));

import { advanceCases } from './reconfirm.service';

const dialect = new PgDialect();
const ctx = { db: {} as never, tenantId: 'org-1' };
const NOW = new Date('2026-11-25T15:00:00Z');
const START = new Date('2026-11-27T22:15:00Z'); // 17:15 in Lima

interface Stmt {
  text: string;
  params: unknown[];
}
const caseRow = (over: Record<string, unknown> = {}) => ({
  id: 'case-1',
  booking_id: 'b1',
  agent_state: 'none',
  channel: 'whatsapp',
  account_id: 'acct',
  recipient: '+51 999 000 111',
  opened_at: '2026-11-25T14:50:00Z',
  wait_until: null,
  ask_at: null,
  start_time: START.toISOString(),
  attendee_name: 'Ana',
  service_title: 'Afinamiento Facial',
  timezone: 'America/Lima',
  opt_out: '',
  ...over,
});

let open: unknown[];
let humanWrote: boolean;
let clientWrote: boolean;
let claimFree: boolean;
let log: Stmt[];
beforeEach(() => {
  vi.clearAllMocks();
  open = [caseRow()];
  humanWrote = false;
  clientWrote = false;
  claimFree = true;
  log = [];
  h.config = { enabled: true, negationWaitHours: 24, locale: 'es', fromName: 'FACES' };
  h.gateway.mockResolvedValue({ messageId: 'wa-1' });
  h.insertMessages.mockResolvedValue(undefined);
  h.tx = {
    execute: async (q: SQL) => {
      const { sql: raw, params } = dialect.sqlToQuery(q);
      const text = raw.replace(/\s+/g, ' ').trim();
      log.push({ text, params });
      if (text.includes('from sched_reconfirm_cases c join sched_bookings')) return open;
      if (text.includes("direction = 'outbound'")) return humanWrote ? [{ '?column?': 1 }] : [];
      if (text.includes("direction = 'inbound'")) return clientWrote ? [{ '?column?': 1 }] : [];
      if (text.includes('insert into sched_reconfirm_events') && text.includes("'agent_message'"))
        return claimFree ? [{ id: 'ev-1' }] : [];
      if (text.includes('update sched_reconfirm_cases set result')) return [{ id: 'case-1' }];
      return [];
    },
  };
});

const stmts = (needle: string) => log.filter((s) => s.text.includes(needle));

describe('advanceCases: the question', () => {
  it('sends one templated question to the reminder phone and account, then waits', async () => {
    const r = await advanceCases(ctx, NOW);
    expect(r).toMatchObject({ asked: 1, failed: 0 });
    expect(h.gateway).toHaveBeenCalledTimes(1);
    const [method, payload] = h.gateway.mock.calls[0]!;
    expect(method).toBe('channels.send');
    expect(payload).toMatchObject({
      channel: 'whatsapp',
      to: '+51 999 000 111',
      accountId: 'acct',
      idempotencyKey: 'reconf-case-1-ask',
    });
    expect(payload.text).toBe(
      'Hola Ana. Entiendo que no podrás venir el viernes 27/11 a las 17:15 a tu cita de Afinamiento Facial en FACES. ¿Prefieres que te busquemos otra fecha (dime qué día y a qué hora te acomoda), o no deseas continuar con la cita?',
    );
    expect(payload.text).not.toMatch(/\{|undefined|null/);
    const waiting = stmts("agent_state = 'asking'")[0]!;
    expect(waiting.params).toContain('2026-11-26T15:00:00.000Z'); // now + 24 h
    expect(h.insertMessages).toHaveBeenCalledTimes(1);
    expect(h.insertMessages.mock.calls[0]![2][0]).toMatchObject({
      agentId: 'reminders-agent',
      metadata: { kind: 'reconfirm', step: 'ask' },
    });
  });

  it('reminders turned off (FR-007): nothing is read and nothing is sent', async () => {
    h.config = { ...h.config, enabled: false };
    const r = await advanceCases(ctx, NOW);
    expect(r).toMatchObject({ asked: 0, timedOut: 0, failed: 0 });
    expect(h.gateway).not.toHaveBeenCalled();
    expect(log).toHaveLength(0);
  });

  it('never sends twice: a claim already held (second tick) sends nothing', async () => {
    claimFree = false;
    const r = await advanceCases(ctx, NOW);
    expect(r.asked).toBe(0);
    expect(h.gateway).not.toHaveBeenCalled();
  });

  it('caps the wait at 2 h before the start', async () => {
    open = [caseRow({ start_time: new Date(NOW.getTime() + 10 * 3_600_000).toISOString() })];
    await advanceCases(ctx, NOW);
    const waiting = stmts("agent_state = 'asking'")[0]!;
    expect(waiting.params).toContain(new Date(NOW.getTime() + 8 * 3_600_000).toISOString());
  });

  it('inside 2 h of the start: no message, result late_reply', async () => {
    open = [caseRow({ start_time: new Date(NOW.getTime() + 90 * 60_000).toISOString() })];
    await advanceCases(ctx, NOW);
    expect(h.gateway).not.toHaveBeenCalled();
    expect(stmts('set result = ')[0]!.params).toContain('late_reply');
  });

  it('an opted-out contact gets no message and staff see send_failed', async () => {
    open = [caseRow({ opt_out: 'true' })];
    const r = await advanceCases(ctx, NOW);
    expect(h.gateway).not.toHaveBeenCalled();
    expect(r.failed).toBe(1);
    expect(stmts('set result = ')[0]!.params).toContain('send_failed');
  });

  it('a person wrote in the chat after the case opened: staff_handling, the agent stops', async () => {
    humanWrote = true;
    await advanceCases(ctx, NOW);
    expect(h.gateway).not.toHaveBeenCalled();
    expect(stmts('set result = ')[0]!.params).toContain('staff_handling');
    // the guard ignores the agent's own and the reminders' rows
    const guard = stmts("direction = 'outbound'")[0]!.text;
    expect(guard).toContain("not in ('reminder','reconfirm')");
    expect(guard).toContain("agent_id,'') <> 'reminders-agent'");
  });

  it('a failed send ends as send_failed and is not retried', async () => {
    h.gateway.mockRejectedValue(new Error('gateway down'));
    const r = await advanceCases(ctx, NOW);
    expect(r).toMatchObject({ asked: 0, failed: 1 });
    expect(stmts('set result = ')[0]!.params).toContain('send_failed');
    expect(h.gateway).toHaveBeenCalledTimes(1);
  });
});

describe('advanceCases: the wait', () => {
  const asking = (over: Record<string, unknown> = {}) =>
    caseRow({
      agent_state: 'asking',
      wait_until: '2026-11-25T14:00:00Z',
      ask_at: '2026-11-24T14:00:00Z',
      ...over,
    });

  it('no answer by wait_until: no_answer', async () => {
    open = [asking()];
    const r = await advanceCases(ctx, NOW);
    expect(r.timedOut).toBe(1);
    expect(stmts('set result = ')[0]!.params).toContain('no_answer');
    expect(h.gateway).not.toHaveBeenCalled();
  });

  it('the client wrote something we did not act on: unclear', async () => {
    open = [asking()];
    clientWrote = true;
    await advanceCases(ctx, NOW);
    expect(stmts('set result = ')[0]!.params).toContain('unclear');
  });

  it('still waiting before wait_until: nothing happens', async () => {
    open = [asking({ wait_until: '2026-11-26T14:00:00Z' })];
    const r = await advanceCases(ctx, NOW);
    expect(r.timedOut).toBe(0);
    expect(stmts('set result = ')).toHaveLength(0);
  });

  it('handles at most `cap` cases per call (the query limit)', async () => {
    open = [];
    await advanceCases(ctx, NOW, 7);
    expect(stmts('from sched_reconfirm_cases c join sched_bookings')[0]!.params).toContain(7);
  });
});

describe('invariant: the agent never cancels', () => {
  it('the module imports no cancel, release or redemption path and never writes a booking', () => {
    const src = readFileSync(new URL('./reconfirm.service.ts', import.meta.url), 'utf8');
    const imports = src
      .split('\n')
      .filter((l) => /^import /.test(l))
      .join('\n');
    expect(imports).not.toMatch(/scheduling-bookings|stock|package|redeem|refund|cancel/i);
    expect(src).not.toMatch(/update sched_bookings/i);
  });
});
