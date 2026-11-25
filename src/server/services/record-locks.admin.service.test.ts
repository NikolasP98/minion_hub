import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'owner' as string | null,
  authority: null as Error | null,
  selects: [] as unknown[][],
  executes: [] as unknown[][],
  wheres: [] as unknown[],
  inserts: [] as Array<{ values: Record<string, unknown>; conflict?: Record<string, unknown> }>,
  insertError: null as unknown,
  returns: [] as unknown[][],
  updates: [] as Array<{ set: Record<string, unknown>; rows: unknown[] }>,
  updateRows: [] as unknown[][],
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
import { HookError, parseHookBody } from './record-locks.logic';
import {
  consumeUnlockInTx,
  applyExternalLock,
  grantUnlock,
  isOrgOwner,
  liftLock,
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
  h.wheres = [];
  h.insertError = null;
  h.returns = [];
  h.updates = [];
  h.updateRows = [];
  const chain = (): unknown =>
    new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          const v = h.selects.shift() ?? [];
          return (ok: (x: unknown) => unknown) => Promise.resolve(v).then(ok);
        }
        if (prop === 'where') return (w: unknown) => (h.wheres.push(w), chain());
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
        onConflictDoNothing() {
          return api;
        },
        returning: async () => {
          if (h.insertError) throw h.insertError;
          return h.returns.shift() ?? [{ id: 'evt-1' }];
        },
        // `await insert().values(...)` without returning
        then: (ok: (x: unknown) => unknown) => Promise.resolve(undefined).then(ok),
      };
      return api;
    },
    update: () => {
      const rec = { set: {} as Record<string, unknown>, rows: [] as unknown[] };
      h.updates.push(rec);
      const api = {
        set(v: Record<string, unknown>) {
          rec.set = v;
          return api;
        },
        where() {
          return api;
        },
        returning: async () => (rec.rows = h.updateRows.shift() ?? []),
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
  it('matches on the rule kinds, so a rule that newly applies still logs a row', async () => {
    const render = async (rules: Array<{ kind: string }>) => {
      h.wheres = [];
      h.selects = [[]];
      await logLockEvent(ctx, { ...refused, rules: rules as never }, { dedupeMs: 600_000 });
      const { PgDialect } = await import('drizzle-orm/pg-core');
      return new PgDialect().sqlToQuery(h.wheres[0] as never).params;
    };
    expect(await render([{ kind: 'month' }])).toContain('month');
    expect(await render([{ kind: 'month' }, { kind: 'days' }])).toContain('days,month');
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

describe('applyExternalLock (spec 140 S4)', () => {
  const KEY = { id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', name: 'Contador' };
  const now = new Date('2026-11-24T15:00:00Z');
  const body = (o: Record<string, unknown>) =>
    parseHookBody({ action: 'lock', label: 'Contabilidad', ...o });
  const on = [policyRow({ webhookEnabled: true })];
  const R1 = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
  const R2 = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

  it('refuses while "Por webhook" is off and writes nothing', async () => {
    h.selects = [[]];
    await expect(
      applyExternalLock(ctx, KEY, body({ upTo: '2026-10-31' }), { now }),
    ).rejects.toMatchObject({ code: 'webhook_rule_off', status: 409 });
    expect(h.inserts).toHaveLength(0);
  });

  it('locks up to a date: one row for the key, one lock event with the key name', async () => {
    h.selects = [on, [{ timezone: 'America/Lima' }]];
    h.returns = [[{ id: 'lock-1' }]];
    const out = await applyExternalLock(ctx, KEY, body({ upTo: '2026-10-31' }), { now });
    expect(out).toEqual({
      action: 'lock',
      created: 1,
      existing: 0,
      unknown: [],
      locks: [{ id: 'lock-1', label: 'Contabilidad', upTo: '2026-10-31' }],
    });
    expect(h.inserts[0]!.values).toMatchObject({
      orgId: ORG,
      source: 'webhook',
      label: 'Contabilidad',
      upTo: '2026-10-31',
      apiKeyId: KEY.id,
      actorName: 'Contador',
      recordType: null,
    });
    expect(h.inserts[1]!.values).toMatchObject({
      action: 'lock',
      actorKind: 'api_key',
      actorId: KEY.id,
      actorName: 'Contador',
      detail: { lockId: 'lock-1', label: 'Contabilidad', upTo: '2026-10-31' },
    });
  });

  it('the same call again is idempotent: created 0, existing 1, no second event', async () => {
    h.selects = [on, [{ timezone: 'America/Lima' }], [{ id: 'lock-1' }]];
    h.returns = [[]];
    const out = await applyExternalLock(ctx, KEY, body({ upTo: '2026-10-31' }), { now });
    expect(out).toMatchObject({ created: 0, existing: 1, locks: [{ id: 'lock-1' }] });
    expect(h.inserts).toHaveLength(1); // only the (ignored) lock insert
  });

  it('a date in the future (in the org timezone) is refused', async () => {
    h.selects = [on, [{ timezone: 'America/Lima' }]];
    await expect(
      applyExternalLock(ctx, KEY, body({ upTo: '2026-11-25' }), { now }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.inserts).toHaveLength(0);
    // 15:00Z on the 24th is the 24th in Lima: today is allowed.
    h.selects = [on, [{ timezone: 'America/Lima' }]];
    h.returns = [[{ id: 'l' }]];
    await expect(
      applyExternalLock(ctx, KEY, body({ upTo: '2026-11-24' }), { now }),
    ).resolves.toMatchObject({ created: 1 });
  });

  it('locks by ids: skips existing, reports unknown ids, one event per new lock', async () => {
    const unknown = '10101010-1010-4010-8010-101010101010';
    h.selects = [on, [{ id: R1 }, { id: R2 }], [{ id: 'a' }, { id: 'b' }]];
    h.returns = [[{ id: 'a', recordId: R1 }]]; // R2 was already locked
    const out = await applyExternalLock(
      ctx,
      KEY,
      body({ recordType: 'stock_receipt', ids: [R1, R2, unknown] }),
      { now },
    );
    expect(out).toMatchObject({ created: 1, existing: 1, unknown: [unknown] });
    expect(h.inserts[0]!.values).toEqual([
      expect.objectContaining({ recordId: R1, recordType: 'stock_receipt', apiKeyId: KEY.id }),
      expect.objectContaining({ recordId: R2 }),
    ]);
    expect(h.inserts[1]!.values).toEqual([
      expect.objectContaining({ action: 'lock', recordId: R1, actorKind: 'api_key' }),
    ]);
  });

  it('only unknown ids: nothing is stored', async () => {
    h.selects = [on, []];
    const out = await applyExternalLock(
      ctx,
      KEY,
      body({ recordType: 'stock_receipt', ids: [R1] }),
      { now },
    );
    expect(out).toMatchObject({ created: 0, existing: 0, unknown: [R1], locks: [] });
    expect(h.inserts).toHaveLength(0);
  });

  it('lifts by date and by ids, one lift event per lock, 0 when nothing matches', async () => {
    h.selects = [on];
    h.updateRows = [
      [
        {
          id: 'lock-1',
          label: 'Contabilidad',
          upTo: '2026-10-31',
          recordType: null,
          recordId: null,
        },
      ],
    ];
    const lift = parseHookBody({ action: 'lift', label: 'Contabilidad', upTo: '2026-10-31' });
    expect(await applyExternalLock(ctx, KEY, lift, { now })).toEqual({ action: 'lift', lifted: 1 });
    expect(h.updates[0]!.set).toMatchObject({ liftedByKind: 'api_key', liftedBy: KEY.id });
    expect(h.inserts[0]!.values).toEqual([
      expect.objectContaining({
        action: 'lift',
        actorName: 'Contador',
        detail: expect.objectContaining({ lockId: 'lock-1' }),
      }),
    ]);

    h.inserts = [];
    h.selects = [on];
    h.updateRows = [[]];
    const none = parseHookBody({ action: 'lift', recordType: 'stock_receipt', ids: [R1] });
    expect(await applyExternalLock(ctx, KEY, none, { now })).toEqual({ action: 'lift', lifted: 0 });
    expect(h.inserts).toHaveLength(0);
  });

  it('a lift is also refused while the rule is off (HookError)', async () => {
    h.selects = [[]];
    await expect(
      applyExternalLock(
        ctx,
        KEY,
        parseHookBody({ action: 'lift', label: 'x', upTo: '2026-10-31' }),
        { now },
      ),
    ).rejects.toBeInstanceOf(HookError);
  });
});

describe('liftLock (owner)', () => {
  const LOCK = '11111111-1111-4111-8111-111111111111';
  const row = {
    id: LOCK,
    label: 'Contabilidad',
    upTo: '2026-10-31',
    recordType: null,
    recordId: null,
    liftedAt: null,
  };

  it('an owner lifts with a reason: the lock row and one lift event record who and why', async () => {
    h.selects = [[row]];
    h.updateRows = [[{ id: LOCK }]];
    expect(await liftLock(ctx, LOCK, '  ya corregido  ', actor)).toEqual({ lifted: true });
    expect(h.updates[0]!.set).toMatchObject({
      liftedByKind: 'person',
      liftedBy: ME,
      liftReason: 'ya corregido',
    });
    expect(h.inserts[0]!.values).toMatchObject({
      action: 'lift',
      reason: 'ya corregido',
      actorKind: 'person',
      detail: { lockId: LOCK, label: 'Contabilidad', upTo: '2026-10-31' },
    });
  });

  it('an already lifted lock answers lifted:false and writes nothing', async () => {
    h.selects = [[{ ...row, liftedAt: new Date() }]];
    expect(await liftLock(ctx, LOCK, 'x', actor)).toEqual({ lifted: false });
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('refuses non-owners, a missing reason, an unknown or foreign lock', async () => {
    h.role = 'admin';
    await expect(liftLock(ctx, LOCK, 'x', actor)).rejects.toMatchObject({ code: 'owner_required' });
    h.role = 'owner';
    await expect(liftLock(ctx, LOCK, '  ', actor)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(liftLock(ctx, 'nope', 'x', actor)).rejects.toMatchObject({ code: 'not_found' });
    h.selects = [[]];
    await expect(liftLock(ctx, LOCK, 'x', actor)).rejects.toMatchObject({ code: 'not_found' });
    expect(h.updates).toHaveLength(0);
  });
});
