import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCK_POLICY,
  evaluateRecordLock,
  isLocked,
  parsePolicyInput,
  type EvaluateInput,
} from './record-locks.logic';
import { CorrectionError, evaluateReceiptPeriod } from './stock-corrections.logic';

const TZ = 'America/Lima';
const at = (iso: string) => new Date(iso);
const base = (over: Partial<EvaluateInput> = {}): EvaluateInput => ({
  policy: DEFAULT_LOCK_POLICY,
  settingsTimezone: TZ,
  now: at('2026-11-20T15:00:00Z'),
  recordType: 'stock_receipt',
  postedAt: at('2026-10-15T15:00:00Z'),
  firstPostedAt: at('2026-10-15T15:00:00Z'),
  chainIds: ['r1'],
  lockedPeriods: new Set<string>(),
  externalLocks: [],
  ...over,
});

/** What spec 124 does today, as the code the caller sees. */
const legacy = (i: EvaluateInput): string => {
  try {
    evaluateReceiptPeriod({
      settingsTimezone: i.settingsTimezone,
      originalPostedAt: i.postedAt,
      now: i.now,
      lockedPeriods: i.lockedPeriods,
    });
    return 'ok';
  } catch (e) {
    return (e as CorrectionError).code;
  }
};
const viaPolicy = (i: EvaluateInput): string => {
  try {
    return evaluateRecordLock(i).length ? 'period_locked' : 'ok';
  } catch (e) {
    return (e as CorrectionError).code;
  }
};

describe('default policy equals receipt_period_v1', () => {
  const cases: Array<[string, Partial<EvaluateInput>]> = [
    ['original month locked', { lockedPeriods: new Set(['2026-10']) }],
    ['current month locked', { lockedPeriods: new Set(['2026-11']) }],
    ['both locked', { lockedPeriods: new Set(['2026-10', '2026-11']) }],
    ['neither locked', { lockedPeriods: new Set(['2026-09']) }],
    ['no finance settings', { settingsTimezone: null }],
    [
      'Lima month boundary: 01 Sep 03:00Z is still August in Lima',
      { postedAt: at('2026-09-01T03:00:00Z'), lockedPeriods: new Set(['2026-08']) },
    ],
    [
      'Lima month boundary: same instant, September locked only',
      { postedAt: at('2026-09-01T03:00:00Z'), lockedPeriods: new Set(['2026-09']) },
    ],
  ];
  it.each(cases)('%s', (_n, over) => {
    const i = base(over);
    expect(viaPolicy(i)).toBe(legacy(i));
  });

  it('the month hits name the periods; the current month is not unlockable', () => {
    const hits = evaluateRecordLock(base({ lockedPeriods: new Set(['2026-10', '2026-11']) }));
    expect(hits).toEqual([
      { rule: 'month', kind: 'month', unlockable: true, period: '2026-10' },
      { rule: 'month', kind: 'month_current', unlockable: false, period: '2026-11' },
    ]);
    expect(isLocked(hits, true)).toBe(true);
  });
  it('a locked original month alone is unlockable', () => {
    const hits = evaluateRecordLock(base({ lockedPeriods: new Set(['2026-10']) }));
    expect(isLocked(hits, false)).toBe(true);
    expect(isLocked(hits, true)).toBe(false);
  });
  it('ignores days and webhook rules while the policy has them off', () => {
    expect(
      evaluateRecordLock(
        base({
          postedAt: at('2020-01-01T15:00:00Z'),
          firstPostedAt: at('2020-01-01T15:00:00Z'),
          externalLocks: [
            {
              id: 'l',
              label: 'X',
              recordType: null,
              upTo: '2030-01-01',
              recordId: null,
              createdAt: at('2026-11-01T00:00:00Z'),
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('days rule', () => {
  const policy = { ...DEFAULT_LOCK_POLICY, days: 30 };
  it('is not locked at X days, locked at X+1', () => {
    // now = 2026-11-20 Lima; 30 days earlier = 2026-10-21
    expect(evaluateRecordLock(base({ policy, firstPostedAt: at('2026-10-21T15:00:00Z') }))).toEqual(
      [],
    );
    expect(evaluateRecordLock(base({ policy, firstPostedAt: at('2026-10-20T15:00:00Z') }))).toEqual(
      [{ rule: 'days', kind: 'days', unlockable: true, days: 30 }],
    );
  });
  it('counts calendar days in the finance timezone, not 24-hour blocks', () => {
    // now 2026-11-21T03:00Z is 22:00 on 11-20 in Lima, so the age is measured to 11-20.
    const now = at('2026-11-21T03:00:00Z');
    expect(
      evaluateRecordLock(base({ policy, now, firstPostedAt: at('2026-10-21T05:00:00Z') })),
    ).toEqual([]);
    // 04:59Z is still 10-20 in Lima (UTC-5): one calendar day older
    expect(
      evaluateRecordLock(base({ policy, now, firstPostedAt: at('2026-10-21T04:59:00Z') })),
    ).toEqual([{ rule: 'days', kind: 'days', unlockable: true, days: 30 }]);
  });
  it('uses the first receipt of the chain, not the replacement', () => {
    const hits = evaluateRecordLock(
      base({
        policy,
        postedAt: at('2026-11-19T15:00:00Z'),
        firstPostedAt: at('2026-08-01T15:00:00Z'),
      }),
    );
    expect(hits.map((h) => h.rule)).toEqual(['days']);
  });
});

describe('webhook rule', () => {
  const policy = { ...DEFAULT_LOCK_POLICY, webhook: true };
  const lock = (over: Record<string, unknown>) => ({
    id: 'l1',
    label: 'Contabilidad',
    recordType: null,
    upTo: null,
    recordId: null,
    createdAt: at('2026-11-05T12:00:00Z'),
    ...over,
  });
  it('locks by date, inclusive', () => {
    const first = at('2026-10-31T15:00:00Z');
    expect(
      evaluateRecordLock(
        base({ policy, firstPostedAt: first, externalLocks: [lock({ upTo: '2026-10-31' })] }),
      ),
    ).toMatchObject([
      {
        rule: 'webhook',
        kind: 'webhook_date',
        label: 'Contabilidad',
        upTo: '2026-10-31',
        lockId: 'l1',
      },
    ]);
    expect(
      evaluateRecordLock(
        base({ policy, firstPostedAt: first, externalLocks: [lock({ upTo: '2026-10-30' })] }),
      ),
    ).toEqual([]);
  });
  it('locks by record id, including a chain id', () => {
    const l = lock({ recordType: 'stock_receipt', recordId: 'first' });
    expect(
      evaluateRecordLock(base({ policy, chainIds: ['r2', 'first'], externalLocks: [l] })),
    ).toMatchObject([{ kind: 'webhook_record' }]);
    expect(evaluateRecordLock(base({ policy, chainIds: ['r2'], externalLocks: [l] }))).toEqual([]);
  });
  it('ignores a lock for another record type', () => {
    expect(
      evaluateRecordLock(
        base({ policy, externalLocks: [lock({ recordType: 'other', upTo: '2030-01-01' })] }),
      ),
    ).toEqual([]);
  });
});

describe('combinations', () => {
  it('returns every hit', () => {
    const hits = evaluateRecordLock(
      base({
        policy: { month: true, days: 5, sunat: false, webhook: true },
        lockedPeriods: new Set(['2026-10']),
        externalLocks: [
          {
            id: 'l',
            label: 'C',
            recordType: null,
            upTo: '2026-12-01',
            recordId: null,
            createdAt: at('2026-11-01T00:00:00Z'),
          },
        ],
      }),
    );
    expect(hits.map((h) => h.kind)).toEqual(['month', 'days', 'webhook_date']);
  });
  it('an active unlock clears only the unlockable hits', () => {
    const mixed = evaluateRecordLock(
      base({
        policy: { ...DEFAULT_LOCK_POLICY, days: 5 },
        lockedPeriods: new Set(['2026-10', '2026-11']),
      }),
    );
    expect(isLocked(mixed, true)).toBe(true); // month_current stays
    const unlockable = evaluateRecordLock(base({ policy: { ...DEFAULT_LOCK_POLICY, days: 5 } }));
    expect(isLocked(unlockable, false)).toBe(true);
    expect(isLocked(unlockable, true)).toBe(false);
    expect(isLocked([], false)).toBe(false);
  });
  it('without finance settings the days rule cannot be verified either', () => {
    expect(() =>
      evaluateRecordLock(
        base({
          policy: { month: false, days: 5, sunat: false, webhook: false },
          settingsTimezone: null,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'policy_unverified' }));
  });
});

describe('parsePolicyInput', () => {
  it('accepts the contract body, with or without sunat:false', () => {
    expect(parsePolicyInput({ month: true, days: 60, webhook: true })).toEqual({
      month: true,
      days: 60,
      sunat: false,
      webhook: true,
    });
    expect(
      parsePolicyInput({ month: true, days: null, sunat: false, webhook: false }).days,
    ).toBeNull();
  });
  it.each([
    null,
    [],
    { month: true, days: 0, webhook: false },
    { month: true, days: 3651, webhook: false },
    { month: true, days: 1.5, webhook: false },
    { month: true, webhook: false }, // days omitted: null must be explicit
    { month: true, days: null, sunat: true, webhook: false },
    { month: 'yes', days: null, webhook: false },
    { month: true, days: null, webhook: false, extra: 1 },
  ])('refuses %j', (raw) => {
    expect(() => parsePolicyInput(raw)).toThrow(
      expect.objectContaining({ code: 'invalid_policy' }),
    );
  });
  it('days errors carry the contract message', () => {
    expect(() => parsePolicyInput({ month: true, days: 0, webhook: false })).toThrow(
      /entre 1 y 3650/,
    );
  });
});
