import { describe, expect, it } from 'vitest';
import { getLockPolicy, recordLockFor } from './record-locks.service';

/** select() answers pop `selects` in call order; execute() (the chain query) pops `executes`. */
function fakeTx(selects: unknown[][], executes: unknown[][]) {
  const sel = [...selects];
  const exe = [...executes];
  const reads: number[] = [];
  const chain = (): unknown =>
    new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          reads.push(1);
          const v = sel.shift() ?? [];
          return (ok: (x: unknown) => unknown) => Promise.resolve(v).then(ok);
        }
        return () => chain();
      },
    });
  return {
    tx: { select: () => chain(), execute: async () => exe.shift() ?? [] } as never,
    reads: () => reads.length,
    left: () => sel.length,
  };
}

const TZ = [{ timezone: 'America/Lima' }];
const rec = {
  type: 'stock_receipt' as const,
  id: 'r2',
  postedAt: new Date('2026-11-19T15:00:00Z'),
};
const now = new Date('2026-11-20T15:00:00Z');
const policyRow = (over: Record<string, unknown> = {}) => ({
  monthEnabled: true,
  daysEnabled: false,
  days: null,
  sunatEnabled: false,
  webhookEnabled: false,
  ...over,
});

describe('getLockPolicy', () => {
  it('no row -> the default policy', async () => {
    const { tx } = fakeTx([[]], []);
    expect(await getLockPolicy(tx, 'org')).toEqual({
      month: true,
      days: null,
      sunat: false,
      webhook: false,
    });
  });
});

describe('recordLockFor', () => {
  it('no policy row -> default policy, month evidence only, no external-lock read', async () => {
    // reads: policy, settings, period locks (3). A fourth read would be the external locks.
    const f = fakeTx([[], TZ, [{ period: '2026-09' }]], []);
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r).toMatchObject({
      locked: false,
      rules: [],
      hasPolicyRow: false,
      lockedPeriods: ['2026-09'],
      externalLockIds: [],
    });
    expect(r.period).toMatchObject({
      policyId: 'receipt_period_v1',
      originalMonth: '2026-11',
      currentMonth: '2026-11',
    });
    expect(f.reads()).toBe(3);
  });

  it('a locked month is a month hit', async () => {
    const f = fakeTx([[], TZ, [{ period: '2026-11' }]], []);
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r.locked).toBe(true);
    expect(r.rules).toEqual([
      { rule: 'month', kind: 'month_current', unlockable: false, period: '2026-11' },
    ]);
  });

  it('a replacement receipt resolves the first receipt date and the chain ids', async () => {
    const chain = [
      { id: 'r2', posted_at: '2026-11-19T15:00:00Z' },
      { id: 'r1', posted_at: '2026-08-01T15:00:00Z' },
    ];
    const f = fakeTx([[policyRow({ daysEnabled: true, days: 30 })], TZ, []], [chain]);
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r.rules.map((h) => h.rule)).toEqual(['days']); // own date is 1 day old; the first receipt is 111
    expect(r.hasPolicyRow).toBe(true);
  });

  it('external locks by a chain id apply only while the webhook rule is on', async () => {
    const chain = [
      { id: 'r2', posted_at: '2026-11-19T15:00:00Z' },
      { id: 'r1', posted_at: '2026-08-01T15:00:00Z' },
    ];
    const ext = {
      id: 'l1',
      label: 'Contabilidad',
      recordType: 'stock_receipt',
      upTo: null,
      recordId: 'r1',
      createdAt: new Date('2026-11-05T00:00:00Z'),
    };
    const on = fakeTx([[policyRow({ webhookEnabled: true })], TZ, [], [ext]], [chain]);
    const hit = await recordLockFor(on.tx, 'org', rec, { now });
    expect(hit.rules).toMatchObject([
      { kind: 'webhook_record', label: 'Contabilidad', lockId: 'l1' },
    ]);
    expect(hit.externalLockIds).toEqual(['l1']);

    // Only locks that hit THIS record are listed (an unrelated active lock is not).
    const other = { ...ext, id: 'l2', recordId: 'zz' };
    const two = fakeTx([[policyRow({ webhookEnabled: true })], TZ, [], [ext, other]], [chain]);
    expect((await recordLockFor(two.tx, 'org', rec, { now })).externalLockIds).toEqual(['l1']);

    const off = fakeTx([[policyRow()], TZ, [], [ext]], [chain]);
    const miss = await recordLockFor(off.tx, 'org', rec, { now });
    expect(miss.rules).toEqual([]);
    expect(off.left()).toBe(1); // the external-lock read never happened
  });

  it('no finance settings -> policy_unverified propagates', async () => {
    const f = fakeTx([[], [], []], []);
    await expect(recordLockFor(f.tx, 'org', rec, { now })).rejects.toMatchObject({
      code: 'policy_unverified',
    });
  });

  it('a record with no chain rows still evaluates against its own date', async () => {
    const f = fakeTx([[policyRow({ daysEnabled: true, days: 1 })], TZ, []], [[]]);
    const old = { ...rec, postedAt: new Date('2026-10-01T15:00:00Z') };
    expect((await recordLockFor(f.tx, 'org', old, { now })).rules.map((h) => h.rule)).toEqual([
      'days',
    ]);
  });

  it('fails closed when the replacement chain hits the cap', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `r${i}`,
      posted_at: '2026-11-19T15:00:00Z',
    }));
    const f = fakeTx([[policyRow({ daysEnabled: true, days: 3650 })], TZ, []], [rows]);
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r.locked).toBe(true);
    expect(r.rules).toMatchObject([{ kind: 'chain_unverified' }]);
  });

  it("keeps today's answer for an org without days or webhook rules, even at the cap", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `r${i}`,
      posted_at: '2026-11-19T15:00:00Z',
    }));
    const f = fakeTx([[], TZ, []], [rows]);
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r.rules.map((h) => h.kind)).not.toContain('chain_unverified');
  });

  it('fails closed when the oldest receipt has no posted_at', async () => {
    const f = fakeTx(
      [[policyRow({ daysEnabled: true, days: 3650 })], TZ, []],
      [
        [
          { id: 'r2', posted_at: '2026-11-19T15:00:00Z' },
          { id: 'r1', posted_at: null },
        ],
      ],
    );
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r.locked).toBe(true);
    expect(r.rules.map((h) => h.kind)).toEqual(['chain_unverified']);
  });

  it('a chain of exactly the cap minus one is still evaluated normally', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      posted_at: '2026-11-19T15:00:00Z',
    }));
    const f = fakeTx([[], TZ, []], [rows]);
    expect((await recordLockFor(f.tx, 'org', rec, { now })).locked).toBe(false);
  });

  it('the chain query follows receipt_chain corrections too', async () => {
    let text = '';
    const f = fakeTx([[], TZ, []], []);
    const tx = {
      ...(f.tx as object),
      execute: async (q: unknown) => {
        text = JSON.stringify(q);
        return [];
      },
    } as never;
    await recordLockFor(tx, 'org', rec, { now });
    expect(text).toContain('receipt_chain');
  });
});

describe('recordLockFor with an owner unlock (spec 140 S3)', () => {
  const chain = [
    { id: 'r2', posted_at: '2026-11-19T15:00:00Z' },
    { id: 'r1', posted_at: '2026-08-01T15:00:00Z' },
  ];
  const days30 = [policyRow({ daysEnabled: true, days: 30 })];

  it('an active unlock clears the verdict, keeps every rule and names the grant', async () => {
    const f = fakeTx(
      [
        days30,
        TZ,
        [],
        [{ id: 'u1', expiresAt: new Date('2026-11-21T10:00:00Z'), actorName: 'Ada' }],
      ],
      [chain],
    );
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r.locked).toBe(false);
    expect(r.rules).toEqual([{ rule: 'days', kind: 'days', unlockable: true, days: 30 }]);
    expect(r.unlock).toEqual({
      eventId: 'u1',
      expiresAt: '2026-11-21T10:00:00.000Z',
      grantedByName: 'Ada',
    });
  });

  it('no unlock row -> still locked, unlock null', async () => {
    const f = fakeTx([days30, TZ, [], []], [chain]);
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r).toMatchObject({ locked: true, unlock: null });
  });

  it('an unlocked record costs no unlock read', async () => {
    const f = fakeTx([[], TZ, []], []);
    expect((await recordLockFor(f.tx, 'org', rec, { now })).unlock).toBeNull();
    expect(f.reads()).toBe(3);
  });

  it('an unlock never clears a closed current month', async () => {
    const f = fakeTx(
      [
        [],
        TZ,
        [{ period: '2026-11' }],
        [{ id: 'u1', expiresAt: new Date('2026-11-21T10:00:00Z'), actorName: null }],
      ],
      [],
    );
    const r = await recordLockFor(f.tx, 'org', rec, { now });
    expect(r.locked).toBe(true);
    expect(r.rules[0]).toMatchObject({ kind: 'month_current', unlockable: false });
  });
});
