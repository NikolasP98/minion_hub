import { describe, it, expect } from 'vitest';
import {
  ratio,
  stageRates,
  funnelMetrics,
  reachability,
  assignTiers,
  reachTotals,
  type CustomerRow,
} from './funnel-logic';

const row = (o: Partial<CustomerRow> & { partyId: string }): CustomerRow => ({
  name: o.partyId,
  spend: 0,
  count: 1,
  lastAt: '2026-11-01',
  phone: false,
  email: false,
  whatsapp: false,
  instagram: false,
  tier: 1,
  ...o,
});

describe('ratio', () => {
  it('is null on zero or missing denominator, never 0 or Infinity', () => {
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(5, null)).toBeNull();
    expect(ratio(null, 5)).toBeNull();
    expect(ratio(0, 5)).toBe(0);
    expect(ratio(1000, 4)).toBe(250);
  });
});

describe('stageRates', () => {
  it('rate between consecutive stages; null when previous is 0 (US3 1-2)', () => {
    expect(stageRates([1000, 100, 0, 5])).toEqual([null, 0.1, 0, null]);
  });
});

describe('funnelMetrics', () => {
  const base = {
    spend: 1000,
    firstTime: 4,
    customers: 10,
    lifetimeTotal: 17000,
    repeatCustomers: 6,
    revenue: 5000,
    sales: 10,
  };
  it('computes all six metrics (US2-1)', () => {
    expect(funnelMetrics(base)).toEqual({
      cac: 250,
      ltv: 1700,
      ltvCac: 6.8,
      roas: 5,
      avgTicket: 500,
      repeatRate: 0.6,
    });
  });
  it('no ad spend => cac, ltvCac, roas null (US2-2)', () => {
    const m = funnelMetrics({ ...base, spend: 0 });
    expect(m.cac).toBeNull();
    expect(m.ltvCac).toBeNull();
    expect(m.roas).toBeNull();
    expect(m.avgTicket).toBe(500);
  });
  it('no first-time customers => cac null; no customers => ltv and repeat null', () => {
    expect(funnelMetrics({ ...base, firstTime: 0 }).cac).toBeNull();
    const m = funnelMetrics({ ...base, customers: 0 });
    expect(m.ltv).toBeNull();
    expect(m.repeatRate).toBeNull();
  });
});

describe('reachability', () => {
  it('lists kinds once; empty means not reachable (US1-3)', () => {
    expect(reachability(row({ partyId: 'a', phone: true, whatsapp: true }))).toEqual([
      'phone',
      'whatsapp',
    ]);
    expect(reachability(row({ partyId: 'b' }))).toEqual([]);
  });
});

describe('assignTiers', () => {
  it('sorts by spend desc and splits in thirds (FR-004)', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => ({ ...row({ partyId: `p${n}`, spend: n * 10 }) }));
    const out = assignTiers(rows);
    expect(out.map((r) => r.partyId)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2', 'p1']);
    expect(out.map((r) => r.tier)).toEqual([1, 1, 2, 2, 3, 3]);
  });
  it('remainder goes to the top tiers like ntile (7 rows => 3,2,2)', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row({ partyId: `p${n}`, spend: n }));
    expect(assignTiers(rows).map((r) => r.tier)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });
  it('handles empty', () => {
    expect(assignTiers([])).toEqual([]);
  });
});

describe('reachTotals', () => {
  const rows = assignTiers([
    row({ partyId: 'a', spend: 300, count: 2, phone: true }),
    row({ partyId: 'b', spend: 200, instagram: true, phone: true }),
    row({ partyId: 'c', spend: 100 }),
  ]);
  it('totals', () => {
    expect(reachTotals(rows)).toEqual({
      customers: 3,
      reachable: 2,
      notReachable: 1,
      phone: 2,
      email: 0,
      whatsapp: 0,
      instagram: 1,
    });
  });
});
