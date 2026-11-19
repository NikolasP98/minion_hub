// Pure math for the /pos/funnel page (spec 132). No I/O.

export type ReachKind = 'phone' | 'email' | 'whatsapp' | 'instagram';
export const REACH_KINDS: ReachKind[] = ['phone', 'email', 'whatsapp', 'instagram'];
export type Tier = 1 | 2 | 3; // 1 = top third by lifetime spend

export interface CustomerRow {
  partyId: string;
  name: string;
  spend: number;
  count: number;
  lastAt: string;
  phone: boolean;
  email: boolean;
  whatsapp: boolean;
  instagram: boolean;
  tier: Tier;
}

/** n / d, or null when either is missing or d is 0 — the UI shows "not enough data". */
export function ratio(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || d === 0) return null;
  return n / d;
}

/** Rate of each stage over the previous one; the first stage has none. */
export function stageRates(stages: number[]): (number | null)[] {
  return stages.map((s, i) => (i === 0 ? null : ratio(s, stages[i - 1])));
}

export interface MetricsInput {
  spend: number;
  firstTime: number;
  customers: number;
  lifetimeTotal: number;
  repeatCustomers: number;
  revenue: number;
  sales: number;
}

export function funnelMetrics(i: MetricsInput) {
  const cac = i.spend > 0 ? ratio(i.spend, i.firstTime) : null; // no spend => no cost to divide
  const ltv = ratio(i.lifetimeTotal, i.customers);
  return {
    cac,
    ltv,
    ltvCac: ratio(ltv, cac),
    roas: ratio(i.revenue, i.spend),
    avgTicket: ratio(i.revenue, i.sales),
    repeatRate: ratio(i.repeatCustomers, i.customers),
  };
}

export function reachability(r: Pick<CustomerRow, ReachKind>): ReachKind[] {
  return REACH_KINDS.filter((k) => r[k]);
}

/** Sorts by lifetime spend desc and tags thirds like SQL ntile(3): remainder goes to the top tiers. */
export function assignTiers(rows: CustomerRow[]): CustomerRow[] {
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  const n = sorted.length;
  const base = Math.floor(n / 3);
  const extra = n % 3;
  const t1 = base + (extra > 0 ? 1 : 0);
  const t2 = t1 + base + (extra > 1 ? 1 : 0);
  return sorted.map((r, i) => ({ ...r, tier: (i < t1 ? 1 : i < t2 ? 2 : 3) as Tier }));
}

export interface CustomerFilter {
  reach: 'any' | ReachKind | 'none';
  tier: 'all' | Tier;
}

export function filterCustomers(rows: CustomerRow[], f: CustomerFilter): CustomerRow[] {
  return rows.filter((r) => {
    if (f.tier !== 'all' && r.tier !== f.tier) return false;
    if (f.reach === 'any') return true;
    if (f.reach === 'none') return reachability(r).length === 0;
    return r[f.reach];
  });
}

export function reachTotals(rows: CustomerRow[]) {
  const reachable = rows.filter((r) => reachability(r).length > 0).length;
  const per = (k: ReachKind) => rows.filter((r) => r[k]).length;
  return {
    customers: rows.length,
    reachable,
    notReachable: rows.length - reachable,
    phone: per('phone'),
    email: per('email'),
    whatsapp: per('whatsapp'),
    instagram: per('instagram'),
  };
}
