// src/lib/finance/period.ts
export type Bucket = 'day' | 'week' | 'month';
export type Period = { from: string | null; to: string | null; bucket: Bucket };
const BUCKETS: Bucket[] = ['day', 'week', 'month'];
function iso(v: string | null): string | null {
  if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function parsePeriod(url: URL): Period {
  const bucketRaw = url.searchParams.get('bucket');
  const bucket: Bucket = BUCKETS.includes(bucketRaw as Bucket) ? (bucketRaw as Bucket) : 'month';
  let from = iso(url.searchParams.get('from'));
  let to = iso(url.searchParams.get('to'));
  if (from && to && Date.parse(from) > Date.parse(to)) [from, to] = [to, from];
  return { from, to, bucket };
}
