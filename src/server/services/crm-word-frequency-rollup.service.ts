import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { isStopword, isWordlike } from '$lib/components/crm/crm-insights';

function canonicalRange(fromIso: string, toIso: string): { fromIso: string; toIso: string } {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new Error('wordFrequencyRollup: invalid date range');
  }
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/** UTC-date word frequency backed entirely by daily document-frequency
 * rollups. Complete UTC day buckets are the deliberate product contract for
 * this trend-oriented word cloud; a 15-minute refresh keeps the current day
 * fresh while removing all historic tokenization from the request path. */
export function wordFrequencyRollup(
  ctx: CoreCtx,
  opts: { fromIso: string; toIso: string; limit?: number },
): Promise<{ word: string; count: number }[]> {
  const { fromIso, toIso } = canonicalRange(opts.fromIso, opts.toIso);
  const limit = Math.min(200, Math.max(10, Math.floor(opts.limit ?? 80)));
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select word, sum(document_count)::int as count
      from crm_word_frequency_daily
      where org_id = current_setting('app.current_org_id', true)
        and day >= (${fromIso}::timestamptz at time zone 'UTC')::date
        and day <= (${toIso}::timestamptz at time zone 'UTC')::date
        and char_length(word) >= 3
      group by word
      order by sum(document_count) desc
      limit ${sql.raw(String(limit * 2))}
    `)) as unknown as Array<{ word: string; count: number }>;
    return rows
      .map((row) => ({ word: String(row.word), count: Number(row.count) }))
      .filter((row) => isWordlike(row.word) && !isStopword(row.word))
      .slice(0, limit);
  });
}

export async function refreshWordFrequencyRollup(days: number): Promise<number> {
  const boundedDays = Math.min(4_000, Math.max(1, Math.floor(days)));
  const rows = (await getCoreDb().execute(sql`
    select public.crm_refresh_word_frequency_daily(
      (current_date - (${boundedDays}::int - 1))::date,
      current_date
    )::bigint as refreshed
  `)) as unknown as Array<{ refreshed: number | string }>;
  return Number(rows[0]?.refreshed ?? 0);
}
