// Spec 139 regression: the REAL scan / answer / advance code against PGlite with minimal tables.
// External calls (gateway, JEV, slots, booking writers) are mocked. Born from the S2-S4 audit probe
// (P1 scan swallowed the answer, P2 staff takeover, P3 late guard, P4 reminders off, P5 concurrency).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

const h = vi.hoisted(() => ({
  db: null as unknown as {
    transaction: (fn: (tx: unknown) => unknown) => Promise<unknown>;
    execute: (q: unknown) => Promise<unknown>;
  },
  config: {} as Record<string, unknown>,
  inferReply: vi.fn(),
  inferAnswer: vi.fn(),
  send: vi.fn(),
  setStatus: vi.fn(),
  setStatusInTx: vi.fn(),
  slots: vi.fn(),
}));

// The tx keeps its query builder (the inbox rule uses `select`); `execute` returns rows like postgres.js.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    h.db.transaction(async (tx: unknown) =>
      fn(
        new Proxy(tx as Record<string | symbol, unknown>, {
          get(t, p) {
            if (p === 'execute')
              return async (q: unknown) =>
                (
                  (await (t.execute as (q: unknown) => Promise<{ rows: unknown[] }>)(q)) as {
                    rows: unknown[];
                  }
                ).rows;
            const v = t[p];
            return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
          },
        }),
      ),
    ),
}));
vi.mock('./reminder-config.service', async (orig) => ({
  ...(await orig<object>()),
  getReminderConfig: async () => h.config,
}));
vi.mock('./entitlements.service', () => ({
  orgAllows: async () => true,
  assertAiCallAllowed: async () => {},
  isEnforced: () => false,
}));
vi.mock('./reminder-compose', async (orig) => ({
  ...(await orig<object>()),
  inferConfirmationReply: h.inferReply,
  inferReconfirmAnswer: h.inferAnswer,
}));
vi.mock('./scheduling-bookings.service', () => ({
  BookingTransitionError: class extends Error {},
  SlotUnavailableError: class extends Error {},
  BookingConflictError: class extends Error {},
  AssistantRescheduleError: class extends Error {},
  setBookingStatus: h.setStatus,
  setBookingStatusInTx: h.setStatusInTx,
  rescheduleAssistantBookingInTx: vi.fn(),
}));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({
    execute: async (q: unknown) => ((await h.db.execute(q)) as { rows: unknown[] }).rows,
  }),
}));
vi.mock('./scheduling-slots.service', () => ({ getSlotsForEventType: h.slots }));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: h.send }));
vi.mock('./messages.service', () => ({ insertMessages: async () => {} }));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import { scanConfirmationReplies } from './reminders.service';
import { advanceCases } from './reconfirm.service';
import { reapStaleSends } from './stale-sends.service';
import { caseTitle } from '$server/scheduling/reconfirm';
import { advanceAnswers } from './reconfirm-answer.service';
import { handleInboundForReminders } from './reminder-reply-trigger.service';
import { appointmentReconfirmRule } from './inbox/rules/appointment-reconfirm';
import { BOOKING_CHANGED_TITLE } from '$server/scheduling/reconfirm';

const pg = new PGlite();
const ORG = 'org-1';
const ctx = { db: {} as never, tenantId: ORG };
const B1 = '00000000-0000-4000-8000-0000000000b1';
const ET = '00000000-0000-4000-8000-0000000000e1';
const RES = '00000000-0000-4000-8000-0000000000a1';
const PHONE = '+51999000111';
const H = 3_600_000;

beforeAll(async () => {
  await pg.exec(`
    create table sched_bookings (id uuid primary key, org_id text, status text, start_time timestamptz,
      end_time timestamptz, attendee_name text, crm_contact_id uuid, metadata jsonb default '{}',
      event_type_id uuid, resource_id uuid, updated_at timestamptz default now());
    create table sched_event_types (id uuid, org_id text, title text);
    create table sched_resources (id uuid, org_id text, name text, timezone text);
    create table crm_contacts (id uuid, custom_fields jsonb default '{}');
    create table crm_activities (org_id text, contact_id uuid, kind text, body text, data jsonb);
    create table sched_reminders (id uuid default gen_random_uuid(), org_id text, booking_id uuid, status text,
      recipient_role text, channel text, recipient text, content text, stage text, sent_at timestamptz,
      account_id text, message_id text, error text, created_at timestamptz default now());
    create table app_notifications (id uuid default gen_random_uuid(), org_id text, kind text, dedupe_key text, resolved_at timestamptz);
    create table crm_door_followups (id uuid default gen_random_uuid(), status text, error text, created_at timestamptz);
    create table pos_emissions (id uuid default gen_random_uuid(), status text, response_description text, updated_at timestamptz);
    create table messages (id uuid primary key default gen_random_uuid(), org_id text, direction text,
      channel text, account_id text, sender_id text, chat_id text, is_group boolean, content text,
      occurred_at timestamptz, metadata jsonb default '{}', agent_id text, message_id text);
    create table sched_reconfirm_cases (id uuid primary key default gen_random_uuid(), org_id text not null,
      booking_id uuid not null, subject_key text not null, contact_id uuid, channel text not null,
      account_id text, recipient text not null, booking_start_at timestamptz not null,
      agent_state text not null default 'none', result text, summary text,
      offered_slots jsonb not null default '[]', offer_booking_updated_at timestamptz, wait_until timestamptz,
      last_inbound_at timestamptz, opened_at timestamptz not null default now(), closed_at timestamptz,
      closed_by uuid, close_action text, close_note text);
    create unique index sched_reconfirm_cases_open_uniq on sched_reconfirm_cases (org_id, subject_key) where closed_at is null;
    create table sched_reconfirm_events (id uuid primary key default gen_random_uuid(), org_id text not null,
      booking_id uuid not null, case_id uuid, kind text not null, verdict text, confidence numeric(4,3), via text,
      content text, send_status text, step text, message_id text, inbound_at timestamptz,
      inbound_message_id uuid, data jsonb not null default '{}', created_at timestamptz not null default now());
    create unique index sched_reconfirm_events_case_step_uniq on sched_reconfirm_events (case_id, step) where kind = 'agent_message';
  `);
  h.db = drizzle(pg) as never;
});
afterAll(() => pg.close());

const at = (ms: number) => new Date(Date.now() + ms).toISOString();
async function seed() {
  await pg.exec(`
    truncate sched_bookings, sched_event_types, sched_resources, sched_reminders, messages,
      sched_reconfirm_cases, sched_reconfirm_events, crm_activities, app_notifications;`);
  await pg.query(
    `insert into sched_bookings values ($1,$2,'pending',$3,$4,'Ana',null,'{}',$5,$6,now())`,
    [B1, ORG, at(48 * H), at(49 * H), ET, RES],
  );
  await pg.query(`insert into sched_event_types values ($1,$2,'Botox')`, [ET, ORG]);
  await pg.query(`insert into sched_resources values ($1,$2,'Dra. Renzo','America/Lima')`, [
    RES,
    ORG,
  ]);
  await pg.query(
    `insert into sched_reminders (org_id,booking_id,status,recipient_role,channel,recipient,content,stage,sent_at,account_id)
     values ($1,$2,'sent','client','whatsapp',$3,'Recordatorio... Responde SÍ o NO','confirmation',$4,'acct')`,
    [ORG, B1, PHONE, at(-3 * H)],
  );
}
const inbound = (content: string, ms: number) =>
  pg.query(
    `insert into messages (org_id,direction,channel,account_id,sender_id,is_group,content,occurred_at)
     values ($1,'inbound','whatsapp','acct',$2,false,$3,$4)`,
    [ORG, PHONE, content, at(ms)],
  );
const staffOutbound = (content: string, ms: number) =>
  pg.query(
    `insert into messages (org_id,direction,channel,account_id,sender_id,chat_id,is_group,content,occurred_at,agent_id)
     values ($1,'outbound','whatsapp','acct',$2,$2,false,$3,$4,null)`,
    [ORG, PHONE, content, at(ms)],
  );
const caseRow = async () =>
  (await pg.query<Record<string, unknown>>(`select * from sched_reconfirm_cases`)).rows[0]!;
const sentTexts = () => h.send.mock.calls.map((c) => (c[1] as { text: string }).text);

beforeEach(async () => {
  vi.clearAllMocks();
  h.config = {
    enabled: true,
    inferConfirmation: true,
    personalize: false,
    locale: 'es',
    fromName: 'FACES',
    negationWaitHours: 24,
    channels: [{ channel: 'whatsapp', accountId: 'acct' }],
    stages: [],
  };
  h.send.mockResolvedValue({ messageId: 'wa-1' });
  h.inferReply.mockResolvedValue({ verdict: 'negation', confidence: 0.95, via: 'jev' });
  h.inferAnswer.mockResolvedValue({
    verdict: 'other_date',
    confidence: 0.95,
    via: 'jev',
    pick: null,
    day: 'mon',
    partOfDay: 'afternoon',
  });
  h.slots.mockResolvedValue({
    slots: [
      {
        start: new Date(Date.now() + 120 * H),
        end: new Date(Date.now() + 121 * H),
        resourceIds: [RES],
      },
    ],
  });
  await seed();
});

/** "no" -> case; the agent asks. Returns once the case is `asking`. */
async function openAndAsk() {
  await inbound('no voy a poder', -2 * H);
  await scanConfirmationReplies(ctx, new Date());
  await advanceCases(ctx, new Date());
  expect((await caseRow()).agent_state).toBe('asking');
  expect(sentTexts()).toHaveLength(1);
}

describe('P1 the S1 scan must not swallow the answer to the agent question', () => {
  it('real order (scan -> answers): the classifier reads the answer once and the case advances', async () => {
    await openAndAsk();
    await inbound('el lunes en la tarde mejor', 60_000);
    await scanConfirmationReplies(ctx, new Date()); // S1: "another date" is a negation by its criteria
    await advanceAnswers(ctx, new Date());
    expect(h.inferAnswer).toHaveBeenCalledTimes(1);
    expect((await caseRow()).agent_state).not.toBe('asking');
  });
});

describe('P2 staff takeover stops the agent', () => {
  it('a staff message after the question: the client answers and the agent sends nothing', async () => {
    await openAndAsk();
    await staffOutbound('Hola Ana, soy Carla de recepción, te llamo ahora', 30_000);
    await inbound('el lunes en la tarde mejor', 60_000);
    await advanceAnswers(ctx, new Date());
    expect(sentTexts()).toHaveLength(1); // only the question
    expect(h.inferAnswer).not.toHaveBeenCalled();
    expect((await caseRow()).result).toBe('staff_handling');
  });
});

describe('P3 no action after the appointment started', () => {
  it('a "will come" read after the start: no booking write, no message, late_reply', async () => {
    await openAndAsk();
    const past = at(-1 * H);
    await pg.query(`update sched_bookings set start_time = $1`, [past]);
    await pg.query(`update sched_reconfirm_cases set booking_start_at = $1`, [past]);
    await inbound('perdón, sí voy a ir', 60_000);
    h.inferAnswer.mockResolvedValue({
      verdict: 'will_come',
      confidence: 0.95,
      via: 'jev',
      pick: null,
      day: null,
      partOfDay: null,
    });
    await advanceAnswers(ctx, new Date());
    expect(sentTexts()).toHaveLength(1);
    expect(h.setStatusInTx).not.toHaveBeenCalled();
    expect((await caseRow()).result).toBe('late_reply');
  });
});

describe('will_come accepts the booking inside the settle transaction', () => {
  const willCome = {
    verdict: 'will_come',
    confidence: 0.95,
    via: 'jev',
    pick: null,
    day: null,
    partOfDay: null,
  };

  it('control: an unchanged pending booking is accepted and the client is told', async () => {
    await openAndAsk();
    await inbound('sí voy a ir', 60_000);
    h.inferAnswer.mockResolvedValue(willCome);
    await advanceAnswers(ctx, new Date());
    expect(h.setStatusInTx.mock.calls.map((c) => c[3])).toEqual(['accepted']);
    expect(sentTexts()[1]).toMatch(/mantenemos tu cita/);
    expect((await caseRow()).result).toBe('will_come');
  });

  it('staff moved the booking after the answer was read: not accepted, no "mantenemos tu cita"', async () => {
    await openAndAsk();
    await inbound('sí voy a ir', 60_000);
    h.inferAnswer.mockImplementation(async () => {
      // the staff reschedule lands between the read and the accept
      await pg.query(`update sched_bookings set start_time = start_time + interval '1 day'`);
      return willCome;
    });
    await advanceAnswers(ctx, new Date());
    expect(h.setStatusInTx).not.toHaveBeenCalled();
    expect(sentTexts()).toHaveLength(1);
    const c = await caseRow();
    expect(c.result).toBe('staff_handling');
    expect(c.closed_at).toBeNull();
    const ev = await pg.query(
      `select 1 from sched_reconfirm_events where kind = 'system' and data->>'reason' = 'booking_changed'`,
    );
    expect(ev.rows).toHaveLength(1);
  });
});

describe('reminders turned off: the agent writes nothing (FR-007)', () => {
  it('an open case gets no question from the ingest trigger', async () => {
    await inbound('no voy a poder', -2 * H);
    await scanConfirmationReplies(ctx, new Date()); // case opened while reminders were on
    h.config = { ...h.config, enabled: false }; // owner turns reminders off
    await inbound('hola?', 60_000);
    await handleInboundForReminders(ctx, [PHONE]);
    await advanceCases(ctx, new Date());
    expect(sentTexts()).toHaveLength(0);
    expect((await caseRow()).agent_state).toBe('none');
  });
});

describe('concurrent ingest + tick: one question per case', () => {
  it('two waitUntil runs and a tick at once send exactly one question', async () => {
    await inbound('no voy a poder', -2 * H);
    await Promise.all([
      handleInboundForReminders(ctx, [PHONE]),
      handleInboundForReminders(ctx, [PHONE]),
      (async () => {
        await scanConfirmationReplies(ctx, new Date());
        await advanceCases(ctx, new Date());
      })(),
    ]);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect((await pg.query(`select count(*)::int n from sched_reconfirm_cases`)).rows[0]).toEqual({
      n: 1,
    });
  });
});

describe('the old reply scan leaves a booking with an open case to the agent (R5a-R5c)', () => {
  it('an AI org: the answer to the agent is not read by the reminder classifier, nothing is confirmed', async () => {
    await inbound('no voy a poder', -2 * H);
    await scanConfirmationReplies(ctx, new Date());
    await advanceCases(ctx, new Date()); // the agent asks
    expect((await caseRow()).agent_state).toBe('asking');
    h.inferReply.mockClear();
    h.inferReply.mockResolvedValue({ verdict: 'yes', confidence: 0.95, via: 'jev' });
    await inbound('Sí, otra fecha porfa', 60_000);
    const r = await scanConfirmationReplies(ctx, new Date());
    expect(h.inferReply).not.toHaveBeenCalled();
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(r).toEqual({ confirmed: 0, opened: 0, unclear: 0 });
  });
  it('a keyword org: "Sí" to the agent question does not accept the booking', async () => {
    h.config = { ...h.config, inferConfirmation: false };
    await inbound('NO', -2 * H);
    await scanConfirmationReplies(ctx, new Date());
    await advanceCases(ctx, new Date());
    await inbound('Sí', 60_000);
    await scanConfirmationReplies(ctx, new Date());
    expect(h.setStatus).not.toHaveBeenCalled();
  });
  it('control: with no open case a "Sí" still confirms the booking', async () => {
    h.config = { ...h.config, inferConfirmation: false };
    await inbound('Sí', -2 * H);
    await scanConfirmationReplies(ctx, new Date());
    expect(h.setStatus).toHaveBeenCalledTimes(1);
  });
});

describe('after staff close or change the case, replies to that reminder stay with staff (round-3 G)', () => {
  const openThenStaffClose = async (action: 'attended' | 'moved_by_staff' | 'booking_closed') => {
    await inbound('no voy a poder', -2 * H);
    await scanConfirmationReplies(ctx, new Date());
    await advanceCases(ctx, new Date()); // the agent asks
    await pg.query(`update sched_reconfirm_cases set closed_at = now(), close_action = $1`, [
      action,
    ]);
    vi.clearAllMocks();
    h.send.mockResolvedValue({ messageId: 'wa-1' });
  };
  it('keyword org, case marked attended: "Sí, otra fecha porfa" does not accept the booking (G5)', async () => {
    h.config = { ...h.config, inferConfirmation: false };
    await openThenStaffClose('attended');
    await inbound('Sí, otra fecha porfa', 60_000);
    await scanConfirmationReplies(ctx, new Date());
    expect(h.setStatus).not.toHaveBeenCalled();
  });
  it('AI org, staff moved the booking: the answer is not read and the patient gets no message (G2, G7)', async () => {
    await openThenStaffClose('moved_by_staff');
    await inbound('Sí, otra fecha porfa', 60_000);
    const r = await scanConfirmationReplies(ctx, new Date());
    await advanceCases(ctx, new Date());
    expect(h.inferReply).not.toHaveBeenCalled();
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(r).toEqual({ confirmed: 0, opened: 0, unclear: 0 });
  });
  it('a case the agent closed itself still lets a later reply be read (R8c)', async () => {
    h.config = { ...h.config, inferConfirmation: false };
    await openThenStaffClose('agent' as never);
    await inbound('Sí', 60_000);
    await scanConfirmationReplies(ctx, new Date());
    expect(h.setStatus).toHaveBeenCalledTimes(1);
  });
});

describe('staff takeover window starts at the first "no" (R2e)', () => {
  it('staff answered the "no" before the case was opened: the agent does not ask', async () => {
    await inbound('no voy a poder', -2 * H);
    await staffOutbound('Hola Ana, ¿quieres que te reprogramemos?', -2 * H + 60_000);
    await scanConfirmationReplies(ctx, new Date());
    await advanceCases(ctx, new Date());
    expect(sentTexts()).toHaveLength(0);
    expect((await caseRow()).result).toBe('staff_handling');
  });
});

describe('a question that was delivered is never reported as failed (R6a)', () => {
  it('delivered, then the DB write fails: no send_failed now; the reaper says "not confirmed"', async () => {
    await inbound('no voy a poder', -2 * H);
    await scanConfirmationReplies(ctx, new Date());
    await pg.exec(`
      create function boom() returns trigger language plpgsql as $$
      begin if new.agent_state = 'asking' then raise exception 'db down'; end if; return new; end $$;
      create trigger boom before update on sched_reconfirm_cases for each row execute function boom();`);
    const r = await advanceCases(ctx, new Date());
    await pg.exec(`drop trigger boom on sched_reconfirm_cases; drop function boom();`);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(r.failed).toBe(0);
    expect((await caseRow()).result).toBeNull(); // not marked failed while the outcome is unknown
    await pg.query(`update sched_reconfirm_events set created_at = now() - interval '20 minutes'`);
    expect((await reapStaleSends()).reconfirms).toBe(1);
    const c = await caseRow();
    expect(c.result).toBe('send_failed');
    const ev = (
      await pg.query<{ data: Record<string, unknown> }>(
        `select data from sched_reconfirm_events where kind = 'system' and step = 'ask'`,
      )
    ).rows[0]!;
    expect(ev.data).toMatchObject({ error: 'stale_claim', delivery: 'unknown' });
    expect(caseTitle({ agentState: 'done', result: 'send_failed' })).toMatch(/No se confirmó/);
  });
});

const answer = (verdict: string) => ({
  verdict,
  confidence: 0.95,
  via: 'jev',
  pick: null,
  day: null,
  partOfDay: null,
});
const inbox = () => appointmentReconfirmRule.evaluate(ctx as never, new Date());

describe('a booking change during "sí voy" reaches staff (R8)', () => {
  it('staff CANCELLED while the answer was read: the inbox warns, even though the case is closed as stale', async () => {
    await openAndAsk();
    await inbound('ah no, sí voy a ir', 60_000);
    h.inferAnswer.mockImplementation(async () => {
      await pg.query(`update sched_bookings set status = 'cancelled'`);
      return answer('will_come');
    });
    await advanceAnswers(ctx, new Date());
    expect(h.setStatusInTx).not.toHaveBeenCalled();
    const first = await inbox();
    expect((await caseRow()).close_action).toBe('booking_closed');
    expect(first.upserts).toHaveLength(1);
    expect(first.upserts[0]).toMatchObject({ severity: 'warning', title: BOOKING_CHANGED_TITLE });
    expect(first.upserts[0]!.dedupeKey).toMatch(/:staff$/);
    // The next tick keeps showing it (nothing resolves it while it is current).
    expect((await inbox()).upserts).toHaveLength(1);
  });
  it('staff MOVED the booking while the answer was read: same warning', async () => {
    await openAndAsk();
    await inbound('sí voy a ir', 60_000);
    h.inferAnswer.mockImplementation(async () => {
      await pg.query(`update sched_bookings set start_time = start_time + interval '1 day'`);
      return answer('will_come');
    });
    await advanceAnswers(ctx, new Date());
    const r = await inbox();
    expect((await caseRow()).close_action).toBe('moved_by_staff');
    expect(r.upserts.map((d) => [d.severity, d.title])).toEqual([
      ['warning', BOOKING_CHANGED_TITLE],
    ]);
  });
  it('control: staff moving the booking with no answer pending shows nothing', async () => {
    await openAndAsk();
    await pg.query(`update sched_bookings set start_time = start_time + interval '1 day'`);
    expect((await inbox()).upserts).toHaveLength(0);
    expect((await caseRow()).close_action).toBe('moved_by_staff');
  });
});

describe('staff takeover is re-checked right before each send (R2d)', () => {
  it('staff writes while the answer is being read: no offer goes out, the next tick hands over', async () => {
    await openAndAsk();
    await inbound('el lunes en la tarde', 60_000);
    h.inferAnswer.mockImplementation(async () => {
      await staffOutbound('Hola Ana, soy recepción', 120_000);
      return { ...answer('other_date'), day: 'mon' };
    });
    await advanceAnswers(ctx, new Date());
    expect(sentTexts()).toHaveLength(1); // only the question
    await advanceAnswers(ctx, new Date());
    expect((await caseRow()).result).toBe('staff_handling');
  });
  it('staff writes while the answer is read: the closing "mantenemos tu cita" is not sent and staff are warned', async () => {
    await openAndAsk();
    await inbound('sí voy', 60_000);
    h.inferAnswer.mockImplementation(async () => {
      await staffOutbound('Hola Ana, soy recepción', 120_000);
      return answer('will_come');
    });
    await advanceAnswers(ctx, new Date());
    expect(sentTexts()).toHaveLength(1);
    const r = await inbox();
    expect(r.upserts.map((d) => [d.severity, d.dedupeKey!.split(':').at(-1)])).toEqual([
      ['warning', 'done-warn'],
    ]);
  });
});

describe('failed sends warn staff, and the warning is not lost to the info row (R6b, R6c)', () => {
  it('"sí voy" accepted but the closing message fails: warning on its own key', async () => {
    await openAndAsk();
    await inbound('sí voy', 60_000);
    h.inferAnswer.mockResolvedValue(answer('will_come'));
    h.send.mockRejectedValueOnce(new Error('gateway down'));
    await advanceAnswers(ctx, new Date());
    const r = await inbox();
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0]).toMatchObject({ severity: 'warning' });
    expect(r.upserts[0]!.title).toMatch(/no se pudo avisar al cliente/);
    expect(r.upserts[0]!.dedupeKey).toMatch(/:done-warn$/);
  });
  it('an info row written while the send was in flight is resolved when the warning appears', async () => {
    await openAndAsk();
    await inbound('sí voy', 60_000);
    h.inferAnswer.mockResolvedValue(answer('will_come'));
    await advanceAnswers(ctx, new Date());
    const info = await inbox(); // the send succeeded: info row
    expect(info.upserts[0]).toMatchObject({ severity: 'info' });
    await pg.query(
      `insert into app_notifications (org_id, kind, dedupe_key) values ($1, 'appointment.reconfirm', $2)`,
      [ORG, info.upserts[0]!.dedupeKey],
    );
    const c = await caseRow();
    await pg.query(
      `insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, step, data)
       values ($1, $2, $3, 'system', 'closing', '{"error":"send"}')`,
      [ORG, B1, c.id],
    );
    const warn = await inbox();
    expect(warn.upserts[0]!.dedupeKey).toMatch(/:done-warn$/);
    expect(warn.resolve).toEqual([info.upserts[0]!.dedupeKey]);
  });
});
