import { sql } from 'drizzle-orm';
import { generateText } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { getOpenRouterModel } from '$server/llm';
import {
  chunkConversation,
  convoKeyOf,
  loadRowsForConvos,
  syncConversationIndex,
  type SyncedConvo,
} from './crm-conversation-vectors.service';

/**
 * CRM Conversation Intelligence (spec 2026-07-17, §2 WP-A + §6) — the
 * structured-rollup half. Where `similarConversations` answers TARGETED
 * questions ("what did people say about pricing?"), this answers CENSUS
 * questions ("what fraction of conversations are us over-explaining?") via a
 * cheap per-conversation LLM extraction into `crm_conversation_analysis`.
 *
 * Shares the same `crm_conversation_index` signature machinery as the vectorize
 * tick (spec §6) — a conversation is re-analyzed only when its content
 * signature changed since the last successful analysis (`analyzed_at` gate),
 * independent of whether/when it was last vectorized.
 */

const DEFAULT_ANALYZE_BATCH = 120; // LLM cost cap (spec: "Cap 120/run").
// ponytail: verified in local testing — concurrency=5 against OpenRouter's
// google/gemini-2.5-flash structured-output path had a ~80% timeout rate
// (5 sequential calls: 5/5 fast; 5 concurrent: ~1/5 fast, rest hit the 30s
// abort). 2 is gentler on the provider; a stuck call still can't wedge the
// batch (extractOne's abortSignal timeout + this tick's per-item try/catch
// demote it to "retry next tick" either way). Raise if this model/provider
// combo turns out to handle concurrency fine after all.
// generateText (not generateObject) is light enough to raise concurrency and
// still stay under OpenRouter rate limits; per-item failures are caught and
// retried on the next idempotent tick, so a transient 429 spike self-heals.
const CONCURRENCY = 10;

const ANALYSIS_MODEL =
  env.CRM_SENTIMENT_MODEL || env.CRM_FUNNEL_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';

const analysisResultSchema = z.object({
  primary_intent: z.string().default(''),
  pain_points: z.array(z.string()).default([]),
  asked_for: z.string().default(''),
  answered_summary: z.string().default(''),
  over_answered: z.boolean().default(false),
  over_answered_reason: z.string().default(''),
});
type AnalysisResult = z.infer<typeof analysisResultSchema>;

const EXTRACT_TIMEOUT_MS = 45_000;

/** One cheap LLM call: extract intent/pain-points/over-answered verdict from a
 *  single conversation's initial window (chunkConversation's first ~1500-tok
 *  chunk — chronological start, so it IS "the initial window + agent replies"). */
async function extractOne(text: string): Promise<AnalysisResult> {
  const prompt = `You analyze ONE customer-service conversation for a Peruvian aesthetics clinic (mostly Spanish, WhatsApp/Instagram/Telegram DMs). Extract a structured judgment about it.

Return ONLY a JSON object (no prose, no markdown fences) matching this shape:
{
  "primary_intent": "the customer's main goal, one short Spanish phrase",
  "pain_points": ["concrete frustration or objection the customer raised, short Spanish phrase"],
  "asked_for": "what info/action the customer explicitly asked for, in Spanish (empty string if unclear)",
  "answered_summary": "one-sentence Spanish summary of how the agent/business responded",
  "over_answered": false,
  "over_answered_reason": "one short Spanish sentence justifying the over_answered verdict (empty string if over_answered is false)"
}
"over_answered" is true only if the agent gave MUCH more information than the customer asked for (info-dumping, over-explaining). Use [] for pain_points if there are none. Be concise and concrete.

Conversation:
${text.slice(0, 6000)}`;

  // A stuck/slow provider response must not block the whole concurrent batch
  // (mapWithConcurrency's Promise.all waits on every worker) — bound every
  // call so one bad response degrades to a retried-next-tick failure, not a
  // hung tick. Verified in local testing: without this, a single slow/stuck
  // generateObject call on real conversation content hung the entire batch.
  // generateObject (strict json_schema structured output) is too slow on
  // gemini-2.5-flash over OpenRouter for real ~6000-char conversations — it
  // routinely blew past the timeout so every extraction failed (analyzed=0).
  // generateText is markedly faster; the prompt already demands raw JSON, and
  // the schema's per-field .default() tolerates a partial/missing field.
  const { text: raw } = await generateText({
    model: getOpenRouterModel(ANALYSIS_MODEL),
    prompt,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
  });
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`no JSON object in model output: ${raw.slice(0, 80)}`);
  }
  return analysisResultSchema.parse(JSON.parse(raw.slice(start, end + 1)));
}

const FIELD_MAX_CHARS = 240;
const PAIN_POINTS_MAX = 8;

/** Defensive clamp on the model's output — verified in local testing: for
 *  some conversations the model ignores "short phrase" and dumps a paragraph
 *  (occasionally the whole system prompt back) into a field meant to be a
 *  few words. Truncating here keeps `conversationThemes`'s aggregates (and
 *  the chat surface that renders them) from choking on pathological rows;
 *  it does NOT fix the model's verbosity, just bounds its blast radius. */
function clampResult(result: AnalysisResult): AnalysisResult {
  const clamp = (s: string) => (s.length > FIELD_MAX_CHARS ? `${s.slice(0, FIELD_MAX_CHARS)}…` : s);
  return {
    primary_intent: clamp(result.primary_intent),
    pain_points: result.pain_points.slice(0, PAIN_POINTS_MAX).map(clamp),
    asked_for: clamp(result.asked_for),
    answered_summary: clamp(result.answered_summary),
    over_answered: result.over_answered,
    over_answered_reason: clamp(result.over_answered_reason),
  };
}

/** Run `fn` over `items` with bounded concurrency (network-bound LLM calls —
 *  no DB handle touched inside, so this is safe to parallelize; the caller
 *  does one batched DB write after all outcomes settle). Per-item failures are
 *  caught and reported, not thrown — one bad extraction can't sink the batch. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i]) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export interface AnalyzeTickResult {
  skipped?: 'locked';
  processed: number;
  dirty: number;
  analyzed: number;
  failed: number;
  remaining: number;
}

/**
 * POST /api/crm/conversations/analyze/tick worker. Same candidate/dirty
 * machinery as vectorizeTick (spec §6), gated on `analyzed_at` instead of
 * `vectorized_at`. Own advisory-lock namespace (`crm-analyze:`) so this can
 * run concurrently with the vectorize tick without blocking it.
 */
export async function analyzeConversationsTick(
  ctx: CoreCtx,
  opts?: { full?: boolean; limit?: number; offset?: number },
): Promise<AnalyzeTickResult> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return { processed: 0, dirty: 0, analyzed: 0, failed: 0, remaining: 0 };
  const full = opts?.full ?? false;
  const batch = Math.max(1, Math.min(DEFAULT_ANALYZE_BATCH, opts?.limit ?? DEFAULT_ANALYZE_BATCH));
  const offset = Math.max(0, opts?.offset ?? 0);

  // Phase 1 (in-tx): acquire the lock, sync the index, decide what needs
  // analysis, and load the conversation text — all cheap DB work.
  const prepared = await withOrgCore(ctx, async (tx) => {
    const [{ locked }] = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtext('crm-analyze:' || ${ctx.tenantId})) as locked`,
    )) as unknown as Array<{ locked: boolean }>;
    if (!locked) return { locked: false as const };

    const { synced, total } = await syncConversationIndex(tx, { full, batch, offset });
    const needsAnalyze = synced.filter((s) => s.dirty || s.analyzedAt === null);
    if (needsAnalyze.length === 0) {
      return { locked: true as const, synced, total, targets: [] as { convo: SyncedConvo; text: string }[] };
    }

    const rowsByConvo = await loadRowsForConvos(tx, needsAnalyze);
    const targets = needsAnalyze
      .map((s) => ({ convo: s, text: chunkConversation(rowsByConvo.get(convoKeyOf(s)) ?? [])[0] ?? '' }))
      .filter((t) => t.text.length > 0);
    return { locked: true as const, synced, total, targets };
  });

  if (!prepared.locked) return { skipped: 'locked', processed: 0, dirty: 0, analyzed: 0, failed: 0, remaining: 0 };
  const { synced, total, targets } = prepared;
  const remaining = Math.max(0, total - offset - synced.length);
  if (targets.length === 0) return { processed: synced.length, dirty: 0, analyzed: 0, failed: 0, remaining };

  // Phase 2 (out-of-tx): the actual LLM calls — network-bound, concurrency-
  // limited, no DB handle involved so a slow model call can't hold a txn open.
  const outcomes = await mapWithConcurrency(targets, CONCURRENCY, (t) => extractOne(t.text));
  const successes: { convo: SyncedConvo; result: AnalysisResult }[] = [];
  let failed = 0;
  outcomes.forEach((o, i) => {
    if (o.ok) successes.push({ convo: targets[i].convo, result: clampResult(o.value) });
    else failed++;
  });

  // Phase 3 (in-tx): one batched upsert for every successful extraction, then
  // bump analyzed_at only for those — a failed extraction stays eligible for
  // retry on the next tick (its signature is still "dirty" for analysis).
  if (successes.length > 0) {
    await withOrgCore(ctx, async (tx) => {
      const values = sql.join(
        successes.map(
          ({ convo, result }) => sql`(
            current_setting('app.current_org_id', true), ${convo.channel}, ${convo.chatId}, ${convo.contactId}::uuid,
            ${result.primary_intent}, ${JSON.stringify(result.pain_points)}::jsonb, ${result.asked_for},
            ${result.answered_summary}, ${result.over_answered}, ${result.over_answered_reason},
            ${convo.eligibleCount}, ${convo.firstOccurredAt.toISOString()}::timestamptz,
            ${convo.lastOccurredAt.toISOString()}::timestamptz, ${ANALYSIS_MODEL}
          )`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        insert into crm_conversation_analysis
          (org_id, channel, chat_id, contact_id, primary_intent, pain_points, asked_for, answered_summary,
           over_answered, over_answered_reason, msg_count, first_at, last_at, model)
        values ${values}
        on conflict (org_id, channel, chat_id) do update set
          contact_id = excluded.contact_id, primary_intent = excluded.primary_intent,
          pain_points = excluded.pain_points, asked_for = excluded.asked_for,
          answered_summary = excluded.answered_summary, over_answered = excluded.over_answered,
          over_answered_reason = excluded.over_answered_reason, msg_count = excluded.msg_count,
          first_at = excluded.first_at, last_at = excluded.last_at, analyzed_at = now(), model = excluded.model
      `);

      const bumpValues = sql.join(
        successes.map((s) => sql`(${s.convo.channel}::text, ${s.convo.chatId}::text)`),
        sql`, `,
      );
      await tx.execute(sql`
        update crm_conversation_index idx
        set analyzed_at = now()
        from (values ${bumpValues}) as v(channel, chat_id)
        where idx.org_id = current_setting('app.current_org_id', true)
          and idx.channel = v.channel and idx.chat_id = v.chat_id
      `);
    });
  }

  return { processed: synced.length, dirty: targets.length, analyzed: successes.length, failed, remaining };
}

// ── Themes aggregate (WP-B calls this — signature is load-bearing) ─────────

export interface ConversationThemes {
  topPainPoints: { point: string; count: number }[];
  intentDistribution: { intent: string; count: number }[];
  overAnswered: { rate: number; count: number; total: number };
}

/**
 * Aggregate rollup over `crm_conversation_analysis`: top pain points (unnest +
 * count), intent distribution, and the over-explaining rate. This — not
 * semantic search — is what answers "are we giving too much info vs. what
 * customers ask for."
 */
export async function conversationThemes(
  ctx: CoreCtx,
  opts: { channel?: string; since?: string },
): Promise<ConversationThemes> {
  const whereChannel = opts.channel ? sql`and channel = ${opts.channel}` : sql``;
  const whereSince = opts.since ? sql`and last_at >= ${opts.since}::timestamptz` : sql``;

  return withOrgCore(ctx, async (tx) => {
    const painRows = (await tx.execute(sql`
      select lower(trim(pp)) as point, count(*)::int as count
      from crm_conversation_analysis, jsonb_array_elements_text(pain_points) as pp
      where org_id = current_setting('app.current_org_id', true) ${whereChannel} ${whereSince}
        and trim(pp) <> ''
      group by 1
      order by 2 desc
      limit 15
    `)) as unknown as Array<{ point: string; count: number }>;

    const intentRows = (await tx.execute(sql`
      select primary_intent as intent, count(*)::int as count
      from crm_conversation_analysis
      where org_id = current_setting('app.current_org_id', true) and primary_intent is not null and trim(primary_intent) <> ''
        ${whereChannel} ${whereSince}
      group by 1
      order by 2 desc
      limit 15
    `)) as unknown as Array<{ intent: string; count: number }>;

    const [overRow] = (await tx.execute(sql`
      select count(*) filter (where over_answered)::int as over_count, count(*)::int as total
      from crm_conversation_analysis
      where org_id = current_setting('app.current_org_id', true) ${whereChannel} ${whereSince}
    `)) as unknown as Array<{ over_count: number; total: number }>;

    const total = Number(overRow?.total ?? 0);
    const overCount = Number(overRow?.over_count ?? 0);
    return {
      topPainPoints: painRows.map((r) => ({ point: r.point, count: Number(r.count) })),
      intentDistribution: intentRows.map((r) => ({ intent: r.intent, count: Number(r.count) })),
      overAnswered: { rate: total > 0 ? overCount / total : 0, count: overCount, total },
    };
  });
}

/** Conversations indexed (`crm_conversation_index`) but not yet analyzed — the
 *  "N conversations pending" count for the Insights empty-state before the
 *  paid `analyzeConversationsTick` pass has run. */
export function pendingAnalysisCount(ctx: CoreCtx): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select count(*)::int as n
      from crm_conversation_index
      where org_id = current_setting('app.current_org_id', true) and analyzed_at is null
    `)) as unknown as Array<{ n: number }>;
    return Number(row?.n ?? 0);
  });
}
