// Spec 139 regression: the REAL scan / advance code against PGlite with minimal tables.
// External calls (gateway, JEV, slots, booking writers) are mocked. Born from the S2-S4 audit probe.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

const h = vi.hoisted(() => ({
  db: null as unknown as { transaction: (fn: (tx: unknown) => unknown) => Promise<unknown> },
  config: {} as Record<string, unknown>,
  inferReply: vi.fn(),
  send: vi.fn(),
  setStatus: vi.fn(),
  setStatusInTx: vi.fn(),
}));

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    h.db.transaction(async (tx: unknown) => {
      const t = tx as { execute: (q: unknown) => Promise<{ rows: unknown[] }> };
      // postgres.js returns an array; the code under test relies on that.
      return fn({ ...t, execute: async (q: unknown) => (await t.execute(q)).rows });
    }),
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
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: h.send }));
vi.mock('./messages.service', () => ({ insertMessages: async () => {} }));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import { scanConfirmationReplies } from './reminders.service';
import { advanceCases } from './reconfirm.service';
import { handleInboundForReminders } from './reminder-reply-trigger.service';

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
      account_id text, message_id text);
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
      sched_reconfirm_cases, sched_reconfirm_events, crm_activities;`);
  await pg.query(
    `insert into sched_bookings values ($1,$2,'pending',$3,$4,'Ana',null,'{}',$5,$6,now())`,
    [B1, ORG, at(48 * H), at(49 * H), ET, RES],
  );
  await pg.query(`insert into sched_event_types values ($1,$2,'Botox')`, [ET, ORG]);
  await pg.query(`insert into sched_resources values ($1,$2,'Dra. Renzo','America/Lima')`, [RES, ORG]);
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
  await seed();
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
    expect((await pg.query(`select count(*)::int n from sched_reconfirm_cases`)).rows[0]).toEqual({ n: 1 });
  });
});
