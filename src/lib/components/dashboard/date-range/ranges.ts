// Quick-range registry. Each range is a DEFINITION (id + shorthand label +
// resolver), so a dashboard can render any subset, and new ranges are added here
// once rather than re-implemented per page.
import * as m from '$lib/paraglide/messages';

export type RangeId = string;

/** A concrete window. '' on either bound means open (all-time on that side). */
export interface DateRange {
  from: string;
  to: string;
}

/** Everything a resolver may need. `dataMin`/`dataMax` are the real data span. */
export interface RangeContext {
  now: Date;
  dataMin?: string;
  dataMax?: string;
}

export interface RangeDef {
  id: RangeId;
  /** Shorthand label (lazy so the locale is read at render time). */
  label: () => string;
  resolve: (ctx: RangeContext) => DateRange;
  /**
   * Sub-day range — resolves to datetime bounds and is only meaningful on a
   * surface that opted into time-of-day (`withTime`). Hidden everywhere else.
   */
  time?: boolean;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Local 'YYYY-MM-DDTHH:mm' — matches what <input type="datetime-local"> wants. */
export const isoDateTime = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Build a sub-day window ending now, starting `hours` back. */
function backHours(hours: number): (ctx: RangeContext) => DateRange {
  return ({ now }) => {
    const from = new Date(now.getTime() - hours * 3_600_000);
    return { from: isoDateTime(from), to: isoDateTime(now) };
  };
}

/** Build a window ending today, starting `mutate` days/months/years back. */
function back(mutate: (d: Date) => void): (ctx: RangeContext) => DateRange {
  return ({ now }) => {
    const from = new Date(now);
    mutate(from);
    return { from: isoDate(from), to: isoDate(now) };
  };
}

export const RANGE_DEFS: RangeDef[] = [
  // Sub-day (opt-in via `withTime`) — telemetry surfaces only.
  { id: '1h', label: m.dr_q_1h, resolve: backHours(1), time: true },
  { id: '6h', label: m.dr_q_6h, resolve: backHours(6), time: true },
  { id: '24h', label: m.dr_q_24h, resolve: backHours(24), time: true },
  { id: '1d', label: m.dr_q_1d, resolve: back((d) => d.setDate(d.getDate() - 1)) },
  { id: '7d', label: m.dr_q_7d, resolve: back((d) => d.setDate(d.getDate() - 7)) },
  { id: '30d', label: m.dr_q_30d, resolve: back((d) => d.setDate(d.getDate() - 30)) },
  { id: '90d', label: m.dr_q_90d, resolve: back((d) => d.setDate(d.getDate() - 90)) },
  {
    id: 'ytd',
    label: m.dr_q_ytd,
    resolve: ({ now }) => ({ from: `${now.getFullYear()}-01-01`, to: isoDate(now) }),
  },
  { id: '1y', label: m.dr_q_1y, resolve: back((d) => d.setFullYear(d.getFullYear() - 1)) },
  { id: 'mtd', label: m.dr_q_mtd, resolve: back((d) => d.setDate(1)) },
  { id: '2mo', label: m.dr_q_2mo, resolve: back((d) => d.setMonth(d.getMonth() - 2)) },
  { id: '3mo', label: m.dr_q_3mo, resolve: back((d) => d.setMonth(d.getMonth() - 3)) },
  { id: '6mo', label: m.dr_q_6mo, resolve: back((d) => d.setMonth(d.getMonth() - 6)) },
  {
    id: 'all',
    label: m.dr_q_all,
    // Spans the REAL data when known so the inputs show real dates, not blanks.
    resolve: ({ dataMin, dataMax }) => ({ from: dataMin ?? '', to: dataMax ?? '' }),
  },
];

export const ALL_RANGE_IDS: RangeId[] = RANGE_DEFS.map((r) => r.id);

/** Sub-day ids — excluded unless a surface opts into time-of-day. */
export const SUBDAY_RANGE_IDS: RangeId[] = RANGE_DEFS.filter((r) => r.time).map((r) => r.id);

/** Date-granular ids — the default menu for every non-telemetry dashboard. */
export const DATE_RANGE_IDS: RangeId[] = RANGE_DEFS.filter((r) => !r.time).map((r) => r.id);

export const isSubDayRange = (id: RangeId): boolean => rangeDef(id)?.time === true;

/** Sensible pill set; everything else lives behind the show/hide menu. */
export const DEFAULT_VISIBLE_RANGES: RangeId[] = ['1d', '7d', '30d', 'ytd', '1y'];

export function rangeDef(id: RangeId): RangeDef | undefined {
  return RANGE_DEFS.find((r) => r.id === id);
}

export function resolveRange(id: RangeId, ctx: RangeContext): DateRange | null {
  return rangeDef(id)?.resolve(ctx) ?? null;
}

/** Which of `ids` currently produces this exact window (for active highlighting). */
export function matchRange(range: DateRange, ids: RangeId[], ctx: RangeContext): RangeId | null {
  for (const id of ids) {
    const r = resolveRange(id, ctx);
    if (r && r.from === range.from && r.to === range.to) return id;
  }
  return null;
}

/** Keep ids in canonical registry order (menus + pills stay stable). */
export function orderRangeIds(ids: RangeId[]): RangeId[] {
  return ALL_RANGE_IDS.filter((id) => ids.includes(id));
}
