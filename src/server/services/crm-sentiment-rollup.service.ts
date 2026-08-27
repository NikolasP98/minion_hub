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
  if (!orgId) {
    const organizations = (await getCoreDb().execute(sql`
      select distinct org_id
      from crm_message_sentiment
      where org_id is not null
      order by org_id
    `)) as unknown as Array<{ org_id: string }>;
    let refreshed = 0;
    for (const organization of organizations) {
      refreshed += await refreshSentimentRollup(boundedDays, String(organization.org_id));
    }
    return refreshed;
  }
  const rows = (await getCoreDb().execute(sql`
    select public.crm_refresh_sentiment_chat_daily(
      ${orgId},
      (current_date - (${boundedDays}::int - 1))::date,
      current_date
    )::bigint as refreshed
  `)) as unknown as Array<{ refreshed: number | string }>;
  return Number(rows[0]?.refreshed ?? 0);
}

export async function refreshSentimentRollupRange(
  fromDay: string,
  toDay: string,
  orgId: string,
): Promise<number> {
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!dayPattern.test(fromDay) || !dayPattern.test(toDay) || fromDay > toDay || !orgId) {
    throw new Error('refreshSentimentRollupRange: invalid range');
  }
  const rows = (await getCoreDb().execute(sql`
    select public.crm_refresh_sentiment_chat_daily(
      ${orgId},
      ${fromDay}::date,
      ${toDay}::date
    )::bigint as refreshed
  `)) as unknown as Array<{ refreshed: number | string }>;
  return Number(rows[0]?.refreshed ?? 0);
}

function contiguousDayRanges(days: string[]): Array<{ from: string; to: string }> {
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  const unique = [...new Set(days)];
  if (unique.length === 0 || unique.length > 100 || unique.some((day) => !dayPattern.test(day))) {
    throw new Error('refreshSentimentRollupDays: invalid days');
  }
  const parsed = unique
    .map((day) => ({ day, timestamp: Date.parse(`${day}T00:00:00.000Z`) }))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (
    parsed.some(
      ({ day, timestamp }) =>
        !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day,
    )
  ) {
    throw new Error('refreshSentimentRollupDays: invalid days');
  }

  const ranges: Array<{ from: string; to: string }> = [];
  for (const current of parsed) {
    const previous = ranges.at(-1);
    if (
      previous &&
      current.timestamp === Date.parse(`${previous.to}T00:00:00.000Z`) + 24 * 60 * 60_000
    ) {
      previous.to = current.day;
    } else {
      ranges.push({ from: current.day, to: current.day });
    }
  }
  return ranges;
}

/** Refresh only the exact affected days, coalescing adjacent days into bounded
 * ranges so sparse scoring batches never rebuild the intervening history. */
export async function refreshSentimentRollupDays(days: string[], orgId: string): Promise<number> {
  if (!orgId) throw new Error('refreshSentimentRollupDays: organization required');
  let refreshed = 0;
  for (const range of contiguousDayRanges(days)) {
    refreshed += await refreshSentimentRollupRange(range.from, range.to, orgId);
  }
  return refreshed;
}
