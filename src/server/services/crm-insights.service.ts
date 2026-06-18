import { sql } from 'drizzle-orm';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { cached, keys, tags } from '@minion-stack/cache';
import { scopeData } from './base';
import { isStopword, isWordlike, scoreToLabel } from '$lib/components/crm/crm-insights';

const insightsTags = (orgId: string) => tags.tenantDomain(orgId, 'crm');

/**
 * Most-used words in inbound client messages over a date range. Postgres-native
 * frequency via ts_stat over to_tsvector('spanish', content) — Spanish stemming
 * + stopword removal for free; an extra denylist trims chat noise. Cached 5m by
 * range (message ingest does not bust the CRM cache, and word freq is not
 * real-time critical). from/to are pre-validated ISO timestamps; limit is an int.
 */
export function wordFrequency(
  ctx: CoreCtx,
  opts: { fromIso: string; toIso: string; limit?: number },
): Promise<{ word: string; count: number }[]> {
  const limit = Math.min(200, Math.max(10, Math.floor(opts.limit ?? 80)));
  return cached(
    keys.hub('crm-wordfreq', { t: ctx.tenantId, d: scopeData({ from: opts.fromIso, to: opts.toIso, limit }) }),
    { ttl: '5m', swr: '1m', tags: [...insightsTags(ctx.tenantId)] },
    () =>
      withOrgCore(ctx, async (tx) => {
        // ts_stat's argument is a literal SQL string; the org is scoped by the GUC
        // inside the withOrgCore tx, and from/to/limit are app-validated (ISO + int),
        // so inlining them here is safe (no user free-text reaches this string).
        const inner = `select to_tsvector('spanish', coalesce(content,'')) from messages
          where org_id = current_setting('app.current_org_id', true)
            and direction = 'inbound' and is_bot is not true
            and coalesce(occurred_at, created_at) >= '${opts.fromIso}'::timestamptz
            and coalesce(occurred_at, created_at) <= '${opts.toIso}'::timestamptz`;
        const rows = (await tx.execute(sql`
          select word, nentry::int as count
          from ts_stat(${inner})
          where char_length(word) >= 3
          order by nentry desc
          limit ${sql.raw(String(limit * 2))}
        `)) as unknown as Array<{ word: string; count: number }>;
        return rows
          .map((r) => ({ word: String(r.word), count: Number(r.count) }))
          .filter((r) => isWordlike(r.word) && !isStopword(r.word))
          .slice(0, limit);
      }),
  );
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const SENTIMENT_MODEL =
  env.CRM_SENTIMENT_MODEL || env.CRM_FUNNEL_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';

/**
 * Score sentiment for inbound messages that don't yet have a sentiment row.
 * Batched single OpenRouter call returning per-message scores in [-1,1].
 * Failures are swallowed (messages stay unscored, retried next run) so the
 * page never breaks. Returns how many rows were written.
 */
export async function scoreSentimentBatch(ctx: CoreCtx, opts?: { cap?: number }): Promise<{ scored: number }> {
  const cap = Math.min(100, Math.max(1, Math.floor(opts?.cap ?? 50)));
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return { scored: 0 };

  const pending = await withOrgCore(ctx, async (tx) => {
    return (await tx.execute(sql`
      select m.id::text as id, m.content
      from messages m
      where m.org_id = current_setting('app.current_org_id', true)
        and m.direction = 'inbound' and m.is_bot is not true
        and m.content is not null and length(trim(m.content)) > 0
        and not exists (
          select 1 from crm_message_sentiment s
          where s.org_id = m.org_id and s.message_id = m.id
        )
      order by coalesce(m.occurred_at, m.created_at) desc
      limit ${sql.raw(String(cap))}
    `)) as unknown as Array<{ id: string; content: string }>;
  });
  if (pending.length === 0) return { scored: 0 };

  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  const transcript = pending.map((m, i) => `${i + 1}. ${m.content.slice(0, 400).replace(/\n/g, ' ')}`).join('\n');
  const prompt = `You score the SENTIMENT of customer messages to a Peruvian aesthetics clinic (mostly Spanish). For each numbered message return a score in [-1, 1]: -1 very negative/upset, 0 neutral/informational, 1 very positive/enthusiastic.

Return ONLY a JSON array of objects in the same order: [{"i":1,"score":0.0}, ...]. No prose.

Messages:
${transcript}`;

  let scores: Array<{ i: number; score: number }> = [];
  try {
    const res = await generateText({ model: openrouter(SENTIMENT_MODEL), prompt, temperature: 0 });
    const match = res.text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed)) {
        scores = parsed
          .map((p) => p as { i?: unknown; score?: unknown })
          .filter((p) => typeof p.i === 'number' && typeof p.score === 'number')
          .map((p) => ({ i: p.i as number, score: Math.max(-1, Math.min(1, p.score as number)) }));
      }
    }
  } catch {
    return { scored: 0 }; // leave unscored; retried next run
  }
  if (scores.length === 0) return { scored: 0 };

  const rows = scores
    .filter((s) => s.i >= 1 && s.i <= pending.length)
    .map((s) => ({ id: pending[s.i - 1].id, score: s.score, label: scoreToLabel(s.score) }));
  if (rows.length === 0) return { scored: 0 };

  await withOrgCore(ctx, async (tx) => {
    const values = sql.join(
      rows.map(
        (r) =>
          sql`(current_setting('app.current_org_id', true), ${r.id}::uuid, ${r.score}, ${r.label}, ${SENTIMENT_MODEL})`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      insert into crm_message_sentiment (org_id, message_id, score, label, model)
      values ${values}
      on conflict (org_id, message_id) do nothing
    `);
  });
  return { scored: rows.length };
}

/** Monthly average sentiment (chronological). */
export function sentimentByMonth(ctx: CoreCtx): Promise<{ month: string; avg: number; n: number }[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select to_char(date_trunc('month', s.analyzed_at), 'YYYY-MM') as month,
             avg(s.score)::float8 as avg, count(*)::int as n
      from crm_message_sentiment s
      where s.org_id = current_setting('app.current_org_id', true)
      group by 1 order by 1
    `)) as unknown as Array<{ month: string; avg: number; n: number }>;
    return rows.map((r) => ({ month: String(r.month), avg: Number(r.avg), n: Number(r.n) }));
  });
}

/** Trailing-30d average sentiment, or null when nothing scored. */
export function currentSentiment(ctx: CoreCtx): Promise<{ avg: number; n: number } | null> {
  return withOrgCore(ctx, async (tx) => {
    const [r] = (await tx.execute(sql`
      select avg(s.score)::float8 as avg, count(*)::int as n
      from crm_message_sentiment s
      where s.org_id = current_setting('app.current_org_id', true)
        and s.analyzed_at >= now() - interval '30 days'
    `)) as unknown as Array<{ avg: number | null; n: number }>;
    if (!r || Number(r.n) === 0) return null;
    return { avg: Number(r.avg ?? 0), n: Number(r.n) };
  });
}
