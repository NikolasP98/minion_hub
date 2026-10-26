import { sql } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getOpenRouterModel } from '$server/llm';
import { FAQ_A_MAX, FAQ_Q_MAX } from '$lib/doors/kinds/faq';

/**
 * "Draft FAQs from customer questions" (spec 041 FR-010). One on-demand model
 * call over a sample of recent inbound 1:1 messages and the business's next
 * reply. Returns drafts only; nothing is saved until the owner saves the door.
 * Message content never reaches a log.
 */

export const FAQ_SAMPLE_LIMIT = 400;
export const FAQ_MAX_DRAFTS = 10;
const ITEM_CHARS = 300;

export interface FaqDraft {
  q: string;
  a: string;
  count: number;
}

export interface FaqSampleRow {
  question: string;
  reply: string | null;
}

/** Replaces emails, @handles and phone-like digit runs (≥ 7 digits) before text leaves the hub. */
export function scrubPii(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/@/g, ' ')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (run) =>
      run.replace(/\D/g, '').length >= 7 ? '[tel]' : run,
    );
}

/**
 * Latest ≤ 400 inbound, non-group, non-bot messages of the last 90 days (8–500
 * chars), each with the first outbound reply in the same chat within 24 h.
 */
export async function sampleCustomerQuestions(ctx: CoreCtx): Promise<FaqSampleRow[]> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select q.content as question, r.content as reply
      from messages q
      left join lateral (
        select o.content
        from messages o
        where o.org_id = q.org_id
          and o.channel = q.channel
          and o.chat_id = q.chat_id
          and o.direction = 'outbound'
          and nullif(trim(o.content), '') is not null
          and coalesce(o.occurred_at, o.created_at) > coalesce(q.occurred_at, q.created_at)
          and coalesce(o.occurred_at, o.created_at)
            <= coalesce(q.occurred_at, q.created_at) + interval '24 hours'
        order by coalesce(o.occurred_at, o.created_at)
        limit 1
      ) r on true
      where q.org_id = ${ctx.tenantId}
        and q.direction = 'inbound'
        and coalesce(q.is_group, false) = false
        and q.is_bot is not true
        and nullif(trim(q.chat_id), '') is not null
        and coalesce(q.occurred_at, q.created_at) >= now() - interval '90 days'
        and char_length(trim(q.content)) between 8 and 500
      order by coalesce(q.occurred_at, q.created_at) desc
      limit ${sql.raw(String(FAQ_SAMPLE_LIMIT))}
    `),
  )) as unknown as Array<{ question: string; reply: string | null }>;
  return rows.map((r) => ({ question: String(r.question), reply: r.reply ?? null }));
}

const clip = (s: string) => scrubPii(s.replace(/\s+/g, ' ').trim()).slice(0, ITEM_CHARS);

export function buildFaqPrompt(sample: FaqSampleRow[]): string {
  const items = sample
    .map((r, i) => `${i + 1}. C: ${clip(r.question)}${r.reply ? ` || N: ${clip(r.reply)}` : ''}`)
    .join('\n');
  return `You help a small business write its public FAQ. Below are recent customer messages ("C") and, when there was one, the business's next reply ("N").

Group the messages into the most frequently asked questions (ignore greetings, small talk and one-off personal matters). Return at most ${FAQ_MAX_DRAFTS} entries, most frequent first:
- "q": the question as a customer would ask it, generic (no names, dates or personal details).
- "a": a short answer based ONLY on what the business replied. If the business never answered it, return an empty string. Never invent prices, hours or policies.
- "count": how many of the listed messages ask this question.
Write in the language the customers use.

Messages:
${items}`;
}

const draftSchema = z.object({
  drafts: z
    .array(z.object({ q: z.string(), a: z.string(), count: z.number() }))
    .describe(`At most ${FAQ_MAX_DRAFTS} entries`),
});

/** Samples, scrubs and makes ONE model call. 0 messages ⇒ `{drafts: []}` without a call. */
export async function draftFaqsFromConversations(ctx: CoreCtx): Promise<{ drafts: FaqDraft[] }> {
  const sample = await sampleCustomerQuestions(ctx);
  if (sample.length === 0) return { drafts: [] };
  const { object } = await generateObject({
    model: getOpenRouterModel(env.CRM_FAQ_MODEL || 'google/gemini-2.5-flash'),
    schema: draftSchema,
    prompt: buildFaqPrompt(sample),
    temperature: 0.2,
  });
  // The model is not trusted to honour the cap or the config limits.
  const drafts = object.drafts
    .map((d) => ({
      q: d.q.trim().slice(0, FAQ_Q_MAX),
      a: d.a.trim().slice(0, FAQ_A_MAX),
      count: Math.max(0, Math.round(Number(d.count) || 0)),
    }))
    .filter((d) => d.q.length > 0)
    .slice(0, FAQ_MAX_DRAFTS);
  return { drafts };
}
