import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/** A fake Postgres that routes each raw statement by its text and models the one-open-case-per-subject index. */
const h = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(h.tx),
}));

import {
  getCaseForBooking,
  closeCase,
  closeStaleCases,
  lastInboundAt,
  openCase,
  openCaseBookingIds,
} from './reconfirm.service';

const dialect = new PgDialect();
const ctx = { db: {} as never, tenantId: 'org-1' };
const verdict = { verdict: 'negation' as const, confidence: 0.95, via: 'jev' as const };

interface Stmt {
  text: string;
  params: unknown[];
}
function fakeTx() {
  const log: Stmt[] = [];
  const openBySubject = new Map<string, string>(); // subject_key -> case id
  const closed = new Set<string>();
  let n = 0;
  const tx = {
    execute: async (q: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      log.push({ text, params });
      if (text.includes('insert into sched_reconfirm_cases')) {
        const subject = String(params[2]);
        if (openBySubject.has(subject)) return [];
        const id = `case-${(n += 1)}`;
        openBySubject.set(subject, id);
        return [{ id }];
      }
      if (text.includes('update sched_reconfirm_cases set last_inbound_at')) {
        const id = openBySubject.get(String(params[2]));
        return id ? [{ id }] : [];
      }
      if (text.includes('set closed_at = now()')) {
        const id = String(params[3]);
        if (closed.has(id) || ![...openBySubject.values()].includes(id)) return [];
        closed.add(id);
        return [{ id, booking_id: 'b1' }];
      }
      if (text.includes('select 1 from sched_reconfirm_cases')) {
        return [...openBySubject.values()].includes(String(params[0])) ? [{ '?column?': 1 }] : [];
      }
      return [];
    },
  };
  return { tx, log, openBySubject };
}

const input = (over: Partial<Parameters<typeof openCase>[1]> = {}) => ({
  bookingId: 'b1',
  subjectKey: 'b1',
  contactId: null,
  channel: 'whatsapp',
  accountId: 'acct',
  recipient: '+51999000111',
  verdict,
  texts: ['no voy a poder'],
  inboundAt: new Date('2026-11-23T12:00:00Z'),
  ...over,
});

let f: ReturnType<typeof fakeTx>;
beforeEach(() => {
  f = fakeTx();
  h.tx = f.tx;
});

describe('openCase', () => {
  it('creates one case and one verdict event, and nothing else', async () => {
    const r = await openCase(ctx, input());
    expect(r).toEqual({ caseId: 'case-1', created: true });
    const writes = f.log.map((s) => s.text.trim().split(/\s+/).slice(0, 3).join(' '));
    expect(writes).toEqual([
      'insert into sched_reconfirm_cases',
      'insert into sched_reconfirm_events',
    ]);
    const ev = f.log[1]!;
    expect(ev.text).toContain("'verdict'");
    expect(ev.params).toContain(0.95);
    // The start is copied in SQL (a JS Date would drop microseconds and look like a move later).
    expect(f.log[0]!.text).toContain('(select start_time from sched_bookings');
    // No booking, stock or package WRITE of any kind.
    expect(
      f.log.some((s) =>
        /(update|insert into|delete from)\s+(sched_bookings|stk_|pos_)/.test(s.text),
      ),
    ).toBe(false);
  });

  it('a second negation for the same subject returns created:false and adds only an event', async () => {
    await openCase(ctx, input());
    f.log.length = 0;
    const r = await openCase(ctx, input({ texts: ['de verdad no puedo'] }));
    expect(r).toEqual({ caseId: 'case-1', created: false });
    expect(f.log.filter((s) => s.text.includes('insert into sched_reconfirm_events'))).toHaveLength(
      1,
    );
    expect(f.openBySubject.size).toBe(1);
  });

  it('stores the result for a case opened as unclear or late_reply', async () => {
    await openCase(ctx, input({ result: 'late_reply' }));
    expect(f.log[0]!.params).toContain('late_reply');
  });
});

describe('closeCase', () => {
  it('closes once, then reports already_closed; unknown ids are not_found', async () => {
    await openCase(ctx, input());
    expect(await closeCase(ctx, 'case-1', { profileId: 'p1', action: 'attended' })).toBe('closed');
    expect(await closeCase(ctx, 'case-1', { profileId: 'p1', action: 'attended' })).toBe(
      'already_closed',
    );
    expect(await closeCase(ctx, 'nope', { profileId: 'p1', action: 'attended' })).toBe('not_found');
  });

  it('writes one staff_action event and never touches the booking', async () => {
    await openCase(ctx, input());
    f.log.length = 0;
    await closeCase(ctx, 'case-1', { profileId: 'p1', action: 'attended', note: 'llamé' });
    expect(
      f.log.some((s) => s.text.includes("'staff_action'") || s.params.includes('staff_action')),
    ).toBe(true);
    expect(f.log.some((s) => /update sched_bookings/.test(s.text))).toBe(false);
  });
});

describe('closeStaleCases', () => {
  it('closes a case whose booking is no longer live, or whose start changed, in one statement', async () => {
    (f.tx as { execute: unknown }).execute = async (q: SQL) => {
      f.log.push({ ...dialect.sqlToQuery(q), text: dialect.sqlToQuery(q).sql });
      return [{ id: 'c1' }, { id: 'c2' }];
    };
    expect(await closeStaleCases(ctx, new Date('2026-11-24T00:00:00Z'))).toBe(2);
    const text = f.log[0]!.text;
    expect(text).toContain("b.status not in ('pending','accepted')");
    expect(text).toContain('b.start_time <> c.booking_start_at');
    expect(text).toContain("'moved_by_staff'");
    expect(text).toContain("'booking_closed'");
    // One audit event per closed case, written by the same statement.
    expect(text).toContain('insert into sched_reconfirm_events');
    expect(text).toContain("'system'");
  });
});

describe('lookups', () => {
  it('lastInboundAt and openCaseBookingIds short-circuit on no ids', async () => {
    expect((await lastInboundAt(ctx, [])).size).toBe(0);
    expect((await openCaseBookingIds(ctx, [])).size).toBe(0);
    expect(f.log).toHaveLength(0);
  });

  it('lastInboundAt maps booking to its newest classified message', async () => {
    (f.tx as { execute: unknown }).execute = async () => [
      { booking_id: 'b1', last_at: '2026-11-23T12:00:00.000Z', last_id: 'm-9' },
    ];
    const m = await lastInboundAt(ctx, ['b1']);
    expect(m.get('b1')?.at.toISOString()).toBe('2026-11-23T12:00:00.000Z');
    expect(m.get('b1')?.id).toBe('m-9');
  });
});

describe('getCaseForBooking masking (spec 139 S3)', () => {
  const caseRow = {
    id: 'case-1',
    agent_state: 'done',
    result: 'declined',
    summary: null,
    opened_at: '2026-11-25T14:00:00Z',
    wait_until: null,
    contact_id: 'c1',
    recipient: '+51999000111',
    closed_at: null,
    close_action: null,
  };
  const events = [
    {
      kind: 'verdict',
      verdict: 'negation',
      confidence: '0.950',
      content: 'no voy a poder',
      step: null,
      created_at: '2026-11-25T14:00:00Z',
    },
  ];
  const fake = () => ({
    execute: async (q: SQL) => {
      const { sql: text } = dialect.sqlToQuery(q);
      return text.includes('from sched_reconfirm_events') ? events : [caseRow];
    },
  });

  it('masks the recipient and drops message text for a viewer without PII access', async () => {
    h.tx = fake();
    const v = await getCaseForBooking(ctx, ['b1', 'b2'], { maskPii: true });
    expect(v?.masked).toBe(true);
    expect(v?.recipient).not.toContain('999000');
    expect(v?.recipient.endsWith('0111')).toBe(true);
    expect(v?.events[0]).toMatchObject({ verdict: 'negation', confidence: 0.95, content: null });
  });

  it('returns the real values otherwise, and null for no ids', async () => {
    h.tx = fake();
    const v = await getCaseForBooking(ctx, 'b1');
    expect(v).toMatchObject({ masked: false, recipient: '+51999000111' });
    expect(v?.events[0]?.content).toBe('no voy a poder');
    expect(await getCaseForBooking(ctx, [])).toBeNull();
  });
});

describe('invariant: the module cannot cancel, release or redeem', () => {
  it('imports no cancel, release, redemption or booking-status function', () => {
    const src = readFileSync(new URL('./reconfirm.service.ts', import.meta.url), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*(import|\}\s*from)\b/.test(l));
    expect(imports.join('\n')).not.toMatch(
      /cancel|release|redeem|redemption|setBookingStatus|scheduling-bookings|pos-/i,
    );
    // S2 logs failures, but only the case id and the error name: never a phone or message text.
    expect(src).not.toMatch(/console\.(log|warn|info|debug)/);
    for (const line of src.split('\n').filter((l) => l.includes('console.error')))
      expect(line).toMatch(/c\.id, errName\(e\)\);$/);
  });
});
