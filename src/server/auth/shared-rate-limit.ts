import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { checkRateLimit } from './rate-limit';

/**
 * Fixed-window limiter shared by every hub instance (`public_rate_limits`).
 * True = still under `limit` in the current `windowMs` window (this call is counted).
 * The key is hashed before it reaches the database, so callers may put an IP in it.
 * If the database is unreachable it falls back to the per-instance limiter.
 */
export async function checkSharedRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<boolean> {
  const bucket = createHash('sha256').update(key).digest('hex');
  const secs = windowMs / 1000;
  try {
    const db = getCoreDb();
    // All SET expressions read the OLD row, so `fresh` is evaluated once per row.
    const [row] = (await db.execute(sql`
      insert into public_rate_limits as r (bucket, window_start, hits)
      values (${bucket}, now(), 1)
      on conflict (bucket) do update set
        hits = case when r.window_start > now() - make_interval(secs => ${secs}) then r.hits + 1 else 1 end,
        window_start = case when r.window_start > now() - make_interval(secs => ${secs}) then r.window_start else now() end
      returning hits
    `)) as unknown as Array<{ hits: number }>;
    // shortcut: ~1 in 100 calls sweeps day-old buckets; move to the jobs tick if the table grows.
    if (Math.random() < 0.01)
      void db
        .execute(sql`delete from public_rate_limits where window_start < now() - interval '1 day'`)
        .catch(() => {});
    return Number(row?.hits ?? 1) <= limit;
  } catch (e) {
    console.warn('[rate-limit] shared store unavailable, using per-instance', (e as Error)?.name);
    return checkRateLimit(key, limit, windowMs);
  }
}
