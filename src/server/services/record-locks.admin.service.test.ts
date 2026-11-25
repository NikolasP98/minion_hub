import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'owner' as string | null,
  authority: null as Error | null,
  selects: [] as unknown[][],
  executes: [] as unknown[][],
  inserts: [] as Array<{ values: Record<string, unknown>; conflict?: Record<string, unknown> }>,
  insertError: null as unknown,
  tx: null as unknown,
}));

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(h.tx),
  withOrgCoreTransaction: (_ctx: unknown, tx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));
// isOrgOwner reads authority in a READ ONLY snapshot (the bridge's nonlocking mode requires it).
vi.mock('$server/db/pg-client', () => ({
  getOrgTransactionDb: () => ({
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute: async () => [] }),
  }),
}));
vi.mock('./rbac.service', () => ({
  resolveFreshOperatorCapabilitiesForWriteInTransaction: async () => {
    if (h.authority) throw h.authority;
    return { membershipRole: h.role };
  },
  resolveFreshCapabilitiesReadOnlyInTransaction: async () => {
    if (h.authority) throw h.authority;
    return { membershipRole: h.role };
  },
}));

import { OperatorAuthorityError } from '$server/auth/active-operator-principal';
import { CorrectionError } from './stock-corrections.logic';
import {
  consumeUnlockInTx,
  grantUnlock,
  isOrgOwner,
  listLockEvents,
  logLockEvent,
  parseUnlockInput,
  setLockPolicy,
  UNLOCK_TTL_MS,
} from './record-locks.service';

const ORG = 'org-1';
const ME = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const ctx = { db: {}, tenantId: ORG, profileId: ME } as never;
const actor = { kind: 'person' as const, id: ME, name: 'Ada' };
const policyRow = (over: Record<string, unknown> = {}) => ({
  monthEnabled: true,
  daysEnabled: false,
  days: null,
  sunatEnabled: false,
  webhookEnabled: false,
  ...over,
});

beforeEach(() => {
  h.role = 'owner';
  h.authority = null;
  h.selects = [];
  h.executes = [];
  h.inserts = [];
  h.insertError = null;
  const chain = (): unknown =>
    new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          const v = h.selects.shift() ?? [];
          return (ok: (x: unknown) => unknown) => Promise.resolve(v).then(ok);
        }
        return () => chain();
      },
    });
  h.tx = {
    select: () => chain(),
    execute: async () => h.executes.shift() ?? [],
    insert: () => {
      const rec: (typeof h.inserts)[number] = { values: {} };
      h.inserts.push(rec);
      const api = {
        values(v: Record<string, unknown>) {
          rec.values = v;
          return api;
        },
        onConflictDoUpdate(c: { set: Record<string, unknown> }) {
          rec.conflict = c.set;
          return Promise.resolve();
        },
        returning: async () => {
          if (h.insertError) throw h.insertError;
          return [{ id: 'evt-1' }];
        },
      };
      return api;
    },
  };
});

describe('setLockPolicy', () => {
  it('an owner changes the days rule; one policy_changed event carries before and after', async () => {
    h.selects = [[]]; // no row yet -> default
    const out = await setLockPolicy(ctx, { month: true, days: 60, webhook: false }, actor);
    expect(out).toEqual({ month: true, days: 60, sunat: false, webhook: false });
    expect(h.inserts).toHaveLength(2);
    expect(h.inserts[0]!.values).toMatchObject({
      orgId: ORG,
      monthEnabled: true,
      daysEnabled: true,
      days: 60,
      updatedBy: ME,
    });
    expect(h.inserts[1]!.values).toMatchObject({
      orgId: ORG,
      action: 'policy_changed',
      actorKind: 'person',
      actorId: ME,
      actorName: 'Ada',
      detail: {
        before: { month: true, days: null, sunat: false, webhook: false },
        after: { month: true, days: 60, sunat: false, webhook: false },
      },
    });
  });

  it('saving the same values writes nothing', async () => {
    h.selects = [[policyRow({ daysEnabled: true, days: 30 })]];
    await setLockPolicy(ctx, { month: true, days: 30, webhook: false }, actor);
    expect(h.inserts).toHaveLength(0);
    h.selects = [[]];
    await setLockPolicy(ctx, { month: true, days: null, webhook: false }, actor);
    expect(h.inserts).toHaveLength(0);
  });

  it('turning the days rule off clears the stored number and keeps sunat as stored', async () => {
    h.selects = [[policyRow({ daysEnabled: true, days: 30, sunatEnabled: true })]];
    const out = await setLockPolicy(ctx, { month: false, days: null, webhook: true }, actor);
    expect(out).toEqual({ month: false, days: null, sunat: true, webhook: true });
    expect(h.inserts[0]!.values).toMatchObject({
      daysEnabled: false,
      days: null,
      sunatEnabled: true,
    });
  });

  it.each(['admin', 'member', null])(
    'refuses %s with owner_required before any write',
    async (role) => {
      h.role = role;
      await expect(
        setLockPolicy(ctx, { month: true, days: 5, webhook: false }, actor),
      ).rejects.toMatchObject({ code: 'owner_required' });
      expect(h.inserts).toHaveLength(0);
    },
  );

  it('validates before touching the database', async () => {
    for (const days of [0, 3651, 1.5, '7', undefined])
      await expect(
        setLockPolicy(ctx, { month: true, days, webhook: false }, actor),
      ).rejects.toMatchObject({ code: 'invalid_policy' });
    await expect(
      setLockPolicy(ctx, { month: true, days: 5, webhook: false, extra: 1 }, actor),
    ).rejects.toBeInstanceOf(CorrectionError);
    expect(h.inserts).toHaveLength(0);
  });

  it('maps an unavailable authority to 503 and an inactive principal to 403', async () => {
    h.authority = new OperatorAuthorityError('operator_authority_unavailable');
    await expect(
      setLockPolicy(ctx, { month: true, days: 5, webhook: false }, actor),
    ).rejects.toMatchObject({ code: 'unavailable' });
    h.authority = new OperatorAuthorityError('operator_principal_inactive');
    await expect(
      setLockPolicy(ctx, { month: true, days: 5, webhook: false }, actor),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('logLockEvent', () => {
  it('writes one append-only row for the org with the actor snapshot', async () => {
    await logLockEvent(ctx, {
      action: 'refused',
      recordType: 'stock_receipt',
      recordId: 'r1',
      rules: [{ rule: 'days', kind: 'days', unlockable: true, days: 3 }],
      actor,
      detail: { code: 'record_locked' },
    });
    expect(h.inserts[0]!.values).toMatchObject({
      orgId: ORG,
      action: 'refused',
      recordId: 'r1',
      actorKind: 'person',
      reason: null,
      detail: { code: 'record_locked' },
    });
  });
});

describe('logLockEvent dedupe', () => {
  const refused = {
    action: 'refused' as const,
    recordType: 'stock_receipt',
    recordId: 'r1',
    actor,
    detail: { code: 'record_locked' },
  };
  it('skips the row when the same actor, record and code was logged inside the window', async () => {
    h.selects = [[{ id: 'earlier' }]];
    await logLockEvent(ctx, refused, { dedupeMs: 600_000 });
    expect(h.inserts).toHaveLength(0);
  });
  it('writes the row when nothing matched', async () => {
    h.selects = [[]];
    await logLockEvent(ctx, refused, { dedupeMs: 600_000 });
    expect(h.inserts).toHaveLength(1);
  });
});

describe('listLockEvents', () => {
  it('maps rows with the record label and ISO dates', async () => {
    h.selects = [
      [
        {
          e: {
            id: 'e1',
            action: 'unlock',
            recordType: 'stock_receipt',
            recordId: 'r1',
            rules: [],
            actorKind: 'person',
            actorId: ME,
            actorName: 'Ada',
            reason: 'typo',
            detail: {},
            refEventId: null,
            expiresAt: new Date('2026-11-25T10:00:00Z'),
            occurredAt: new Date('2026-11-24T10:00:00Z'),
          },
          label: 'STE-2026-00559',
        },
      ],
    ];
    expect(await listLockEvents(ctx)).toEqual([
      expect.objectContaining({
        id: 'e1',
        recordLabel: 'STE-2026-00559',
        occurredAt: '2026-11-24T10:00:00.000Z',
        expiresAt: '2026-11-25T10:00:00.000Z',
        reason: 'typo',
      }),
    ]);
  });
});

describe('isOrgOwner', () => {
  it('is true only for the owner role', async () => {
    expect(await isOrgOwner(ctx)).toBe(true);
    h.role = 'admin';
    expect(await isOrgOwner(ctx)).toBe(false);
    expect(await isOrgOwner({ ...(ctx as object), profileId: undefined } as never)).toBe(false);
  });

  it('reads an inactive principal as not owner instead of failing the page', async () => {
    h.authority = new Error('operator_principal_inactive');
    expect(await isOrgOwner(ctx)).toBe(false);
    h.authority = null;
  });
});

describe('grantUnlock (spec 140 S3)', () => {
  const REC = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
  const now = new Date('2026-11-24T15:00:00Z');
  const entry = [{ id: REC, postedAt: new Date('2026-11-01T15:00:00Z') }];
  const TZ = [{ timezone: 'America/Lima' }];
  const input = { recordType: 'stock_receipt', recordId: REC, reason: '  Cantidad mal digitada  ' };
  // reads in order: entry, policy, settings, period locks, (unlock when something locks)
  const days = [policyRow({ daysEnabled: true, days: 1 })];

  it('an owner unlocks a locked receipt: one unlock event, 24 h, reason trimmed, rules recorded', async () => {
    h.selects = [entry, days, TZ, [], []];
    const out = await grantUnlock(ctx, input, actor, { now });
    expect(out).toEqual({
      eventId: 'evt-1',
      expiresAt: new Date(now.getTime() + UNLOCK_TTL_MS).toISOString(),
      created: true,
    });
    expect(UNLOCK_TTL_MS).toBe(24 * 3600 * 1000);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]!.values).toMatchObject({
      orgId: ORG,
      action: 'unlock',
      recordType: 'stock_receipt',
      recordId: REC,
      reason: 'Cantidad mal digitada',
      actorKind: 'person',
      actorId: ME,
      expiresAt: new Date(now.getTime() + UNLOCK_TTL_MS),
      rules: [expect.objectContaining({ kind: 'days', days: 1 })],
    });
  });

  it('a second grant while one is active returns it and writes nothing', async () => {
    h.selects = [
      entry,
      days,
      TZ,
      [],
      [
        {
          id: 'evt-0',
          expiresAt: new Date('2026-11-25T01:00:00Z'),
          actorName: 'Ada',
          rules: [{ rule: 'days', kind: 'days', unlockable: true, days: 1 }],
        },
      ],
    ];
    expect(await grantUnlock(ctx, input, actor, { now })).toEqual({
      eventId: 'evt-0',
      expiresAt: '2026-11-25T01:00:00.000Z',
      created: false,
    });
    expect(h.inserts).toHaveLength(0);
  });

  it.each(['admin', 'member'])(
    'refuses %s with owner_required and writes nothing',
    async (role) => {
      h.role = role;
      await expect(grantUnlock(ctx, input, actor, { now })).rejects.toMatchObject({
        code: 'owner_required',
      });
      expect(h.inserts).toHaveLength(0);
    },
  );

  it('an unknown or non-receipt record is not_found', async () => {
    h.selects = [[]];
    await expect(grantUnlock(ctx, input, actor, { now })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('a record nothing locks is not_locked', async () => {
    h.selects = [entry, [], TZ, []];
    await expect(grantUnlock(ctx, input, actor, { now })).rejects.toMatchObject({
      code: 'not_locked',
      status: 409,
    });
    expect(h.inserts).toHaveLength(0);
  });

  it('a closed current month cannot be unlocked: not_unlockable', async () => {
    h.selects = [entry, [], TZ, [{ period: '2026-11' }], []];
    await expect(grantUnlock(ctx, input, actor, { now })).rejects.toMatchObject({
      code: 'not_unlockable',
      status: 409,
    });
    expect(h.inserts).toHaveLength(0);
  });

  it('validates the request before touching the database', () => {
    expect(parseUnlockInput(input)).toEqual({ ...input, reason: 'Cantidad mal digitada' });
    for (const bad of [
      null,
      [],
      { ...input, reason: '   ' },
      { ...input, reason: 'x'.repeat(1001) },
      { ...input, recordId: 'nope' },
      { ...input, recordType: 'pos_ticket' },
      { ...input, extra: 1 },
      { recordType: 'stock_receipt', recordId: REC },
    ])
      expect(() => parseUnlockInput(bad)).toThrow(
        expect.objectContaining({ code: 'invalid_request' }),
      );
  });
});

describe('consumeUnlockInTx', () => {
  const use = {
    eventId: 'evt-0',
    recordId: 'r1',
    correctionId: 'c1',
    rules: [{ rule: 'days', kind: 'days', unlockable: true, days: 1 }] as never,
  };

  it('writes one unlock_used event that points at the unlock and the correction', async () => {
    await consumeUnlockInTx(h.tx as never, ORG, use, actor);
    expect(h.inserts[0]!.values).toMatchObject({
      orgId: ORG,
      action: 'unlock_used',
      recordType: 'stock_receipt',
      recordId: 'r1',
      refEventId: 'evt-0',
      detail: { correctionId: 'c1' },
      actorId: ME,
    });
  });

  it('a second use (unique violation) refuses the correction instead of reusing the unlock', async () => {
    h.insertError = Object.assign(new Error('dup'), { code: '23505' });
    await expect(consumeUnlockInTx(h.tx as never, ORG, use, actor)).rejects.toMatchObject({
      code: 'record_locked',
    });
    h.insertError = new Error('boom');
    await expect(consumeUnlockInTx(h.tx as never, ORG, use, actor)).rejects.toThrow('boom');
  });
});
