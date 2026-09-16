import { describe, it, expect } from 'vitest';
import {
  allocateGrants,
  expiryFrom,
  grantStatus,
  grantToday,
  isExpired,
  isRedeemable,
  ledgerBalance,
  nextDueInstalment,
  parseDueSchedule,
  planProgress,
  sessionsRemaining,
} from './pos-accounts.logic';

describe('ledgerBalance', () => {
  it('sums mixed signs — a consumption is a negative row, not an edit', () => {
    expect(
      ledgerBalance([
        { amount: '200.00' }, // topup
        { amount: '-50.00' }, // redemption
        { amount: 30 }, // refund to credit, as a number
        { amount: '-180.50' }, // redemption
      ]),
    ).toBe(-0.5);
  });

  it('is 0 for a client with no rows, and tolerates junk', () => {
    expect(ledgerBalance([])).toBe(0);
    expect(ledgerBalance([{ amount: null }, { amount: 'not-a-number' }])).toBe(0);
  });

  it('rounds float drift back to cents', () => {
    expect(ledgerBalance([{ amount: '0.1' }, { amount: '0.2' }])).toBe(0.3);
  });

  it('a reversal restores the exact prior balance', () => {
    const rows = [{ amount: '100.00' }, { amount: '-40.00' }];
    expect(ledgerBalance(rows)).toBe(60);
    expect(ledgerBalance([...rows, { amount: '40.00' }])).toBe(100);
  });
});

describe('sessionsRemaining / exhaustion', () => {
  const grant = { sessionsTotal: 4, expiresAt: null };
  const today = '2026-09-13';

  it('counts down and exhausts at exactly 0 remaining', () => {
    expect(sessionsRemaining(4, 0)).toBe(4);
    expect(sessionsRemaining(4, 3)).toBe(1);
    expect(grantStatus({ ...grant, used: 3 }, today)).toBe('active');
    // The boundary: the 4th redemption leaves 0 — still valid to have taken,
    // but the grant is done and a 5th booking must be refused.
    expect(sessionsRemaining(4, 4)).toBe(0);
    expect(grantStatus({ ...grant, used: 4 }, today)).toBe('exhausted');
    expect(isRedeemable({ ...grant, used: 4 }, today)).toBe(false);
    expect(isRedeemable({ ...grant, used: 3 }, today)).toBe(true);
  });

  it('clamps an over-redeemed grant at 0 but still reads exhausted', () => {
    expect(sessionsRemaining(4, 6)).toBe(0);
    expect(grantStatus({ ...grant, used: 6 }, today)).toBe('exhausted');
  });

  it('reversing a redemption gives the session back', () => {
    // 4 redemption rows, one of them reversed -> used counts the live ones.
    const rows = [
      { reversedAt: null },
      { reversedAt: null },
      { reversedAt: null },
      { reversedAt: new Date() },
    ];
    const used = rows.filter((r) => r.reversedAt === null).length;
    expect(used).toBe(3);
    expect(sessionsRemaining(4, used)).toBe(1);
    expect(grantStatus({ ...grant, used }, today)).toBe('active');
  });
});

describe('expiry boundary', () => {
  it('a grant expiring TODAY is still valid; yesterday is not', () => {
    expect(isExpired('2026-09-13', '2026-09-13')).toBe(false);
    expect(isExpired('2026-09-12', '2026-09-13')).toBe(true);
    expect(isExpired('2026-09-14', '2026-09-13')).toBe(false);
    expect(isExpired(null, '2026-09-13')).toBe(false);
  });

  it('grantStatus reports expired only with sessions left', () => {
    expect(grantStatus({ sessionsTotal: 4, used: 1, expiresAt: '2026-09-13' }, '2026-09-13')).toBe(
      'active',
    );
    expect(grantStatus({ sessionsTotal: 4, used: 1, expiresAt: '2026-09-12' }, '2026-09-13')).toBe(
      'expired',
    );
    // Exhausted outranks expired — the client used the package, it did not lapse.
    expect(grantStatus({ sessionsTotal: 4, used: 4, expiresAt: '2026-09-12' }, '2026-09-13')).toBe(
      'exhausted',
    );
    // Cancelled outranks everything.
    expect(
      grantStatus(
        { sessionsTotal: 4, used: 4, expiresAt: '2026-09-12', status: 'cancelled' },
        '2026-09-13',
      ),
    ).toBe('cancelled');
  });

  it('resolves "today" in the org timezone, not UTC', () => {
    // 02:30 UTC on the 14th is still the 13th in Lima (UTC-5). A package
    // expiring on the 13th must NOT be dead for the clinic that evening.
    const instant = new Date('2026-09-14T02:30:00Z');
    expect(grantToday('America/Lima', instant)).toBe('2026-09-13');
    expect(grantToday('UTC', instant)).toBe('2026-09-14');
    expect(isExpired('2026-09-13', grantToday('America/Lima', instant))).toBe(false);
  });

  it('expiryFrom counts calendar days, across a month end', () => {
    expect(expiryFrom('2026-09-13', 90)).toBe('2026-12-12');
    expect(expiryFrom('2026-09-13', null)).toBe(null);
    expect(expiryFrom('2026-09-13', 0)).toBe(null);
  });
});

describe('allocateGrants', () => {
  const edges = [
    { childProductId: 'svc-a', qty: 4 },
    { childProductId: 'svc-b', qty: 2 },
  ];

  it('one package: sessions per edge, value split across all sessions', () => {
    const out = allocateGrants(600, 1, edges);
    expect(out).toEqual([
      { childProductId: 'svc-a', sessionsTotal: 4, unitValue: 100 },
      { childProductId: 'svc-b', sessionsTotal: 2, unitValue: 100 },
    ]);
    expect(out.reduce((a, g) => a + g.unitValue * g.sessionsTotal, 0)).toBe(600);
  });

  it('qty > 1 scales sessions AND keeps the per-session value constant', () => {
    const out = allocateGrants(1200, 2, edges);
    expect(out.map((g) => g.sessionsTotal)).toEqual([8, 4]);
    // Buying the same package twice must not double what a session is worth —
    // 12 sessions for 1200 is still 100 each. (The spec's literal
    // `total / Σ(edge.qty)` would say 200 and claim twice the revenue.)
    expect(out.every((g) => g.unitValue === 100)).toBe(true);
    expect(out.reduce((a, g) => a + g.unitValue * g.sessionsTotal, 0)).toBe(1200);
  });

  it('a single-session package of qty 3 is 3 sessions at the unit price', () => {
    expect(allocateGrants(450, 3, [{ childProductId: 'svc-a', qty: 1 }])).toEqual([
      { childProductId: 'svc-a', sessionsTotal: 3, unitValue: 150 },
    ]);
  });

  it('returns nothing for a non-package line or a nonsense qty', () => {
    expect(allocateGrants(100, 1, [])).toEqual([]);
    expect(allocateGrants(100, 0, edges)).toEqual([]);
    expect(allocateGrants(100, 1, [{ childProductId: 'svc-a', qty: 0 }])).toEqual([]);
  });

  it('rounds the per-session value to cents (documented sub-cent dust)', () => {
    const [g] = allocateGrants(100, 1, [{ childProductId: 'svc-a', qty: 3 }]);
    expect(g.unitValue).toBe(33.33);
  });
});

describe('planProgress', () => {
  it('sums instalment lines and settles on the last one', () => {
    const paid = [{ total: '1000.00' }, { total: '1000.00' }, { total: '1000.00' }];
    expect(planProgress('4000.00', paid)).toEqual({
      paidToDate: 3000,
      remaining: 1000,
      isPaid: false,
    });
    expect(planProgress('4000.00', [...paid, { total: '1000.00' }])).toEqual({
      paidToDate: 4000,
      remaining: 0,
      isPaid: true,
    });
  });

  it('an unpaid plan is 0 paid, and overpayment still settles', () => {
    expect(planProgress(500, [])).toEqual({ paidToDate: 0, remaining: 500, isPaid: false });
    expect(planProgress(500, [{ total: 600 }])).toEqual({
      paidToDate: 600,
      remaining: -100,
      isPaid: true,
    });
  });
});

describe('nextDueInstalment', () => {
  const schedule = [
    { dueOn: '2026-10-01', amount: 1000 },
    { dueOn: '2026-11-01', amount: 1000 },
    { dueOn: '2026-12-01', amount: 2000 },
  ];

  it('is the first instalment the money paid so far does not cover', () => {
    expect(nextDueInstalment(schedule, 0)).toEqual({ dueOn: '2026-10-01', amount: 1000 });
    expect(nextDueInstalment(schedule, 1000)).toEqual({ dueOn: '2026-11-01', amount: 1000 });
    expect(nextDueInstalment(schedule, 2000)).toEqual({ dueOn: '2026-12-01', amount: 2000 });
  });

  it('reports the scheduled amount, not the unpaid remainder, on a part payment', () => {
    expect(nextDueInstalment(schedule, 1500)).toEqual({ dueOn: '2026-11-01', amount: 1000 });
  });

  it('is null with no schedule, and once the whole schedule is covered', () => {
    expect(nextDueInstalment(null, 0)).toBeNull();
    expect(nextDueInstalment([], 0)).toBeNull();
    expect(nextDueInstalment(schedule, 4000)).toBeNull();
    // Same 1-cent tolerance planProgress settles on.
    expect(nextDueInstalment(schedule, 3999.999)).toBeNull();
  });

  it('orders by date and drops malformed entries instead of trusting the jsonb', () => {
    expect(
      parseDueSchedule([
        { dueOn: '2026-11-01', amount: '500' },
        { dueOn: 'soon', amount: 100 },
        { dueOn: '2026-10-01', amount: 0 },
        'nonsense',
        { dueOn: '2026-09-01', amount: 250 },
      ]),
    ).toEqual([
      { dueOn: '2026-09-01', amount: 250 },
      { dueOn: '2026-11-01', amount: 500 },
    ]);
  });
});
