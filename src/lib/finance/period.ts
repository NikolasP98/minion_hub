// src/lib/finance/period.ts
import { zonedDayWindow } from '$lib/components/dashboard/date-range/url';
export type Bucket = 'day' | 'week' | 'month';
export type Period = { from: string | null; to: string | null; bucket: Bucket };
const BUCKETS: Bucket[] = ['day', 'week', 'month'];
function iso(v: string | null): string | null {
  if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function parsePeriod(url: URL): Period {
  const bucketRaw = url.searchParams.get('bucket');
  const bucket: Bucket = BUCKETS.includes(bucketRaw as Bucket) ? (bucketRaw as Bucket) : 'month';
  // Explicit all-time (open range) — bypasses the rolling default below.
  if (url.searchParams.get('range') === 'all') return { from: null, to: null, bucket };
  let from = iso(url.searchParams.get('from'));
  let to = iso(url.searchParams.get('to'));
  // Default view: rolling last 12 months (pre-filled with real dates), so the
  // dashboard opens on a meaningful window instead of all-time.
  if (!from && !to) {
    const now = new Date();
    to = now.toISOString();
    const f = new Date(now);
    f.setMonth(f.getMonth() - 12);
    from = f.toISOString();
  }
  if (from && to && Date.parse(from) > Date.parse(to)) [from, to] = [to, from];
  return { from, to, bucket };
}

/**
 * Resolve the period's calendar days to absolute instants in the BUSINESS
 * timezone. `to` becomes the exclusive start of the next local day, so the whole
 * `to` day counts while SQL keeps comparing a plain indexed `issued_at` (a
 * `issued_at at time zone tz` predicate would not be sargable).
 */
export function resolvePeriodWindow(p: Period, tz: string): Period {
  const w = zonedDayWindow(p.from?.slice(0, 10) ?? '', p.to?.slice(0, 10) ?? '', tz);
  return { ...p, from: w.from?.toISOString() ?? null, to: w.to?.toISOString() ?? null };
}
