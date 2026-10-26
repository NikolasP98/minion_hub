import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * A fake Postgres for the follow-up sweep: it routes each raw statement by its
 * text and models the ONE property the sweep relies on — the unique
 * (org_id, door_id, contact_id) claim — so two overlapping ticks can be raced.
 */
const h = vi.hoisted(() => ({
  db: null as unknown,
  send: vi.fn(),
  catalog: vi.fn(),
  crmOn: true,
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => h.db }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: { db: unknown }, fn: (tx: unknown) => unknown) => fn(ctx.db),
}));
vi.mock('./crm-send.service', () => ({
  sendContactMessage: (...a: unknown[]) => h.send(...a),
}));
vi.mock('./crm-channels.service', () => ({ getChannelCatalog: () => h.catalog() }));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => h.crmOn }));

import {
  FOLLOW_UP_CAP,
  followUpSchema,
  renderFollowUp,
  runDoorFollowUps,
  setFollowUp,
} from './doors-followup.service';

const dialect = new PgDialect();
const DOOR = 'd0000000-0000-4000-8000-000000000001';
const ACCOUNT = 'acct-faces';

type Cand = Record<string, unknown>;
const cand = (contact: string, over: Cand = {}): Cand => ({
  submission_id: `s-${contact}`,
  door_id: DOOR,
  contact_id: contact,
  template: 'Hola {nombre}, ¿te ayudamos?',
  account_id: ACCOUNT,
  display_name: 'Ana',
  phone: '+51900000041',
  opted_out: false,
  bought: false,
  booked: false,
  replied: false,
  ...over,
});

/** `enabledAt` mirrors `crm_doors.follow_up->>'enabledAt'`; a candidate's `submitted_at`
 * is compared to it exactly as the real query does (verified on the QA database). */
function fakeDb(orgs: string[], candidates: Cand[], enabledAt?: string) {
  const claims = new Map<string, { status: string; reason: unknown; error?: unknown }>();
  const statements: string[] = [];
  const execute = vi.fn(async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    statements.push(text);
    await Promise.resolve(); // yield, so concurrent runs interleave between statements
    if (text.includes('select distinct org_id from crm_doors'))
      return orgs.map((o) => ({ org_id: o }));
    if (text.includes('with latest as')) {
      const limit = Number(params[params.length - 1]);
      return candidates
        .filter((c) => !enabledAt || String(c.submitted_at) >= enabledAt)
        .filter((c) => !claims.has(`${params[0]}|${c.door_id}|${c.contact_id}`))
        .slice(0, limit);
    }
    if (text.includes('insert into crm_door_followups')) {
      const key = `${params[0]}|${params[1]}|${params[2]}`;
      if (claims.has(key)) return [];
      claims.set(key, { status: String(params[4]), reason: params[5] });
      return [{ id: key }];
    }
    if (text.includes('update crm_door_followups')) {
      // params: status, recipient, content, error, [sent_at handled in SQL], org, door, contact
      const key = `${params.at(-3)}|${params.at(-2)}|${params.at(-1)}`;
      claims.set(key, { ...claims.get(key)!, status: String(params[0]), error: params[3] });
      return [];
    }
    throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
  });
  return { db: { execute }, claims, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.crmOn = true;
  h.send.mockResolvedValue({ ok: true });
  h.catalog.mockResolvedValue({
    accounts: [
      { channel: 'whatsapp', accountId: ACCOUNT, name: 'FACES', phone: null, enabled: true },
    ],
    defaults: {},
  });
});

describe('renderFollowUp', () => {
  it('replaces {nombre} with the display name, or with nothing', () => {
    expect(renderFollowUp('Hola {nombre}!', 'Ana ')).toBe('Hola Ana!');
    expect(renderFollowUp('{nombre} hola {nombre}', null)).toBe('hola');
  });
});

describe('followUpSchema', () => {
  it('refuses a delay under 15 minutes, an empty or 1001-char template, and unknown keys', () => {
    const ok = { enabled: true, delayMinutes: 15, accountId: 'a', template: 'Hola' };
    expect(followUpSchema.safeParse(ok).success).toBe(true);
    expect(followUpSchema.safeParse({ ...ok, delayMinutes: 14 }).success).toBe(false);
    expect(followUpSchema.safeParse({ ...ok, template: ' ' }).success).toBe(false);
    expect(followUpSchema.safeParse({ ...ok, template: 'x'.repeat(1001) }).success).toBe(false);
    expect(followUpSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe('runDoorFollowUps', () => {
  it('selects only consented, due, unclaimed leads of active form doors with follow-up on', async () => {
    const f = fakeDb(['org-1'], []);
    h.db = f.db;
    await runDoorFollowUps(new Date('2026-10-25T12:00:00Z'));
    const orgs = f.statements[0];
    const due = f.statements[1];
    // The org selector and the candidate query share the door predicate (stranding lesson).
    for (const q of [orgs, due]) {
      expect(q).toMatch(
        /(d\.)?kind = 'form' and (d\.)?active and (d\.)?follow_up->>'enabled' = 'true'/,
      );
    }
    expect(due).toContain('s.consent and s.contact_id is not null');
    expect(due).toContain("interval '7 days'");
    expect(due).toContain("l.created_at >= (d.follow_up->>'enabledAt')::timestamptz");
    expect(due).toContain("greatest(15, (d.follow_up->>'delayMinutes')::int)");
    expect(due).toContain('not exists (select 1 from crm_door_followups f');
    expect(due).toContain('c.deleted_at is null');
    expect(due).toContain("t.status = 'submitted' and t.submitted_at > l.created_at");
    expect(due).toContain("m.direction = 'inbound'");
  });

  it('sends one message through the CRM send path with the door account and a stable key', async () => {
    const f = fakeDb(['org-1'], [cand('c1')]);
    h.db = f.db;
    const r = await runDoorFollowUps();
    expect(r).toMatchObject({ orgs: 1, sent: 1, failed: 0, skipped: 0 });
    expect(h.send).toHaveBeenCalledWith(
      { db: f.db, tenantId: 'org-1' },
      'c1',
      'whatsapp',
      'Hola Ana, ¿te ayudamos?',
      `door-fu-${DOOR}-c1`,
      { accountId: ACCOUNT },
    );
    expect(f.claims.get(`org-1|${DOOR}|c1`)?.status).toBe('sent');
  });

  it.each([
    ['opted_out', { opted_out: true }],
    ['no_identity', { phone: null }],
    ['bought', { bought: true }],
    ['booked', { booked: true }],
    ['replied', { replied: true }],
  ])('skips with reason %s and sends nothing', async (reason, over) => {
    const f = fakeDb(['org-1'], [cand('c1', over)]);
    h.db = f.db;
    const r = await runDoorFollowUps();
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(h.send).not.toHaveBeenCalled();
    expect(f.claims.get(`org-1|${DOOR}|c1`)).toEqual({ status: 'skipped', reason });
  });

  it('opt-out wins over every other signal', async () => {
    const f = fakeDb(['org-1'], [cand('c1', { opted_out: true, bought: true, phone: null })]);
    h.db = f.db;
    await runDoorFollowUps();
    expect(f.claims.get(`org-1|${DOOR}|c1`)?.reason).toBe('opted_out');
  });

  it('two overlapping ticks send exactly once per contact (claim conflict is a no-op)', async () => {
    const f = fakeDb(['org-1'], [cand('c1'), cand('c2')]);
    h.db = f.db;
    const [a, b] = await Promise.all([runDoorFollowUps(), runDoorFollowUps()]);
    expect(a.sent + b.sent).toBe(2);
    // Both ticks read the same due list and both tried to claim: the race really happened.
    expect(f.statements.filter((t) => t.includes('insert into crm_door_followups'))).toHaveLength(
      4,
    );
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls.map((c) => c[1]).sort()).toEqual(['c1', 'c2']);
  });

  it('switching on never messages past leads: before enabledAt never, after exactly once', async () => {
    const enabledAt = '2026-10-25T10:00:00.000Z';
    const f = fakeDb(
      ['org-1'],
      [
        cand('before', { submitted_at: '2026-10-25T09:59:59.000Z' }),
        cand('after', { submitted_at: '2026-10-25T10:00:01.000Z' }),
      ],
      enabledAt,
    );
    h.db = f.db;
    for (let i = 0; i < 3; i++) await runDoorFollowUps();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][1]).toBe('after');
    expect(f.claims.has(`org-1|${DOOR}|before`)).toBe(false);
  });

  it('setFollowUp stamps enabledAt in SQL: kept while on, now() on flip-on, dropped when off', async () => {
    const execute = vi.fn(async () => [{ follow_up: { enabled: true } }]);
    const ctx = { db: { execute } as never, tenantId: 'org-1' };
    const on = { enabled: true, delayMinutes: 15, accountId: 'a', template: 'Hola' };
    expect(await setFollowUp(ctx, DOOR, on)).toEqual({ enabled: true });
    const { sql: text, params } = dialect.sqlToQuery(
      (execute.mock.calls[0] as unknown[])[0] as SQL,
    );
    expect(text).toContain("when not $2 then '{}'::jsonb");
    expect(text).toContain("when follow_up->>'enabled' = 'true' and follow_up ? 'enabledAt'");
    expect(text).toContain("else jsonb_build_object('enabledAt', now())");
    expect(params[1]).toBe(true);
    execute.mockResolvedValueOnce([]);
    expect(await setFollowUp(ctx, DOOR, { ...on, enabled: false })).toBeNull();
  });

  it('ten consecutive ticks still send once (SC-004)', async () => {
    const f = fakeDb(['org-1'], [cand('c1')]);
    h.db = f.db;
    for (let i = 0; i < 10; i++) await runDoorFollowUps();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('a failed send is recorded and never retried', async () => {
    const f = fakeDb(['org-1'], [cand('c1')]);
    h.db = f.db;
    h.send.mockRejectedValueOnce(new Error('gateway unreachable'));
    expect(await runDoorFollowUps()).toMatchObject({ sent: 0, failed: 1 });
    expect(f.claims.get(`org-1|${DOOR}|c1`)).toMatchObject({
      status: 'failed',
      error: 'gateway unreachable',
    });
    await runDoorFollowUps();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it(`caps a run at ${FOLLOW_UP_CAP} claims across orgs`, async () => {
    const many = Array.from({ length: 30 }, (_, i) => cand(`c${i}`));
    const f = fakeDb(['org-1', 'org-2'], many);
    h.db = f.db;
    const r = await runDoorFollowUps();
    expect(r.sent).toBe(FOLLOW_UP_CAP);
    expect(r.orgs).toBe(1); // org-2 not even started: the budget is spent
  });

  it('holds (does not claim) leads whose account is no longer visible to the org', async () => {
    const f = fakeDb(['org-1'], [cand('c1', { account_id: 'acct-of-another-org' })]);
    h.db = f.db;
    expect(await runDoorFollowUps()).toMatchObject({ sent: 0, held: 1 });
    expect(f.claims.size).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('skips an org with the CRM module off', async () => {
    const f = fakeDb(['org-1'], [cand('c1')]);
    h.db = f.db;
    h.crmOn = false;
    await runDoorFollowUps();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('isolates an org failure and logs neither the phone nor the message body', async () => {
    const f = fakeDb(['org-bad', 'org-1'], [cand('c1')]);
    const exec = f.db.execute.getMockImplementation()!;
    f.db.execute.mockImplementation(async (q: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      if (text.includes('with latest as') && params[0] === 'org-bad')
        throw new Error('Failed query: params +51900000041,Hola Ana');
      return exec(q);
    });
    h.db = f.db;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runDoorFollowUps();
    expect(r).toMatchObject({ errors: 1, sent: 1 });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain('+51900000041');
    expect(logged).not.toContain('Hola');
    err.mockRestore();
  });
});
