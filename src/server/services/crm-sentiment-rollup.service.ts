import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { toSentimentGranularity, type SentimentGranularity } from './crm-insights.service';

export function sentimentByDayRollup(
  ctx: CoreCtx,
  opts?: { granularity?: SentimentGranularity },
): Promise<{ day: string; avg: number; n: number }[]> {
  const granularity = toSentimentGranularity(opts?.granularity ?? 'day');
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select to_char(date_trunc('${sql.raw(granularity)}', day::timestamp), 'YYYY-MM-DD') as day,
             avg(score)::float8 as avg,
             sum(message_count)::int as n
      from crm_sentiment_chat_daily
      where org_id = current_setting('app.current_org_id', true)
      group by 1
      order by 1
    `)) as unknown as Array<{ day: string; avg: number; n: number }>;
    return rows.map((row) => ({ day: String(row.day), avg: Number(row.avg), n: Number(row.n) }));
  });
}

export async function refreshSentimentRollup(
  days: number,
  orgId: string | null = null,
): Promise<number> {
  const boundedDays = Math.min(4_000, Math.max(1, Math.floor(days)));
  const rows = (await getCoreDb().execute(sql`
    select public.crm_refresh_sentiment_chat_daily(
      ${orgId},
      (current_date - ${boundedDays}::int)::date,
      current_date
    )::bigint as refreshed
  `)) as unknown as Array<{ refreshed: number | string }>;
  return Number(rows[0]?.refreshed ?? 0);
}
