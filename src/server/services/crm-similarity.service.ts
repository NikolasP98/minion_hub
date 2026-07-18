import { eq, sql } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { withOrgCore } from '$server/db/with-org-core';
import { crmSettings } from '$server/db/pg-crm-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';
import { embedText, embedTexts, embeddingsEnabled, toVectorLiteral } from './embeddings';
import { buildConversationText, isThin } from '$lib/components/crm/crm-similarity';
import { getOpenRouterModel } from '$server/llm';

const winAnalysisResultSchema = z.object({
  wins: z.array(z.object({ point: z.string(), repeat: z.string() })).optional(),
  improvements: z.array(z.object({ area: z.string(), suggestions: z.array(z.string()).optional() })).optional(),
});

const WIN_MODEL =
  env.CRM_FUNNEL_MODEL || env.CRM_SENTIMENT_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';

/** AI breakdown of winning conversations — persisted in crm_settings.winAnalysis. */
export interface WinAnalysis {
  /** What worked + how to repeat it with other customers. */
  wins: { point: string; repeat: string }[];
  /** Where to improve + concrete suggestions. */
  improvements: { area: string; suggestions: string[] }[];
  builtAt: string;
  basedOn: number;
}

const IS_PROCEDURE = sql.raw(`(ii.description is not null and ii.description not ilike '%reserva%')`);

/** Bind a JS string[] as a real Postgres text[] (each element parameterized). */
function textArray(arr: string[]) {
  if (arr.length === 0) return sql`array[]::text[]`;
  return sql`array[${sql.join(arr.map((x) => sql`${x}`), sql`, `)}]::text[]`;
}

/** Bind a JS string[] of uuids as a real Postgres uuid[] (each element parameterized). */
function uuidArray(arr: string[]) {
  if (arr.length === 0) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(arr.map((x) => sql`${x}::uuid`), sql`, `)}]::uuid[]`;
}

/** Split an array into chunks of at most `size` — caps embedding-request and VALUES-list size. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface SimilarWin {
  contactId: string;
  displayName: string | null;
  similarity: number;
  bought: string[];
  snippet: string;
}

// C3 needs buyers (finance) AND an embeddings provider; off → no-op/empty.
async function enabled(ctx: CoreCtx): Promise<boolean> {
  return embeddingsEnabled() && (await bothEnabled(ctx, 'crm', 'finances'));
}

/** Load a contact's conversation text (chronological, inbound/outbound). */
async function conversationText(ctx: CoreCtx, contactId: string): Promise<{ text: string; count: number }> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select m.direction, m.content
      from crm_contact_identities ci
      join messages m on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
      where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = ${contactId}
        and m.is_bot is not true
      order by coalesce(m.occurred_at, m.created_at) asc
    `)) as unknown as Array<{ direction: string; content: string | null }>;
    return { text: buildConversationText(rows), count: rows.length };
  });
}

/**
 * (Re)build the winning-conversation index: embed each procedure-buyer's
 * conversation and upsert it. Idempotent; re-embeds all buyers on every call.
 *
 * Buyers are matched via the party-spine (crm_contacts.party_id →
 * fin_clients.party_id) — reliable across ALL channels, unlike the old
 * phone-number match hard-filtered to WhatsApp (which missed nearly every
 * buyer and all Instagram conversations).
 */
export async function buildWinIndex(ctx: CoreCtx): Promise<{ indexed: number }> {
  if (!(await enabled(ctx))) return { indexed: 0 };

  // Buyers + their conversations in a SINGLE round-trip each (not per-contact):
  // (1) procedure-buyers with bought procedures, (2) every message across every
  // channel for those contacts. Grouping happens in JS — avoids O(buyers)
  // sequential queries.
  const { buyers, messages } = await withOrgCore(ctx, async (tx) => {
    const buyerRows = (await tx.execute(sql`
      select c.id::text id,
             array_agg(distinct ii.description) filter (where ${IS_PROCEDURE}) bought
      from crm_contacts c
      join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = c.party_id
      join fin_invoices fi on fi.client_id = fc.id
      join fin_invoice_items ii on ii.invoice_id = fi.id
      where c.org_id = current_setting('app.current_org_id', true) and c.party_id is not null
      group by c.id
      having bool_or(${IS_PROCEDURE})
    `)) as unknown as Array<{ id: string; bought: string[] | null }>;
    if (buyerRows.length === 0) return { buyers: buyerRows, messages: [] as Array<{ contact_id: string; direction: string; content: string | null }> };
    const buyerIds = buyerRows.map((b) => b.id);
    const msgRows = (await tx.execute(sql`
      select ci.contact_id::text contact_id, m.direction, m.content
      from crm_contact_identities ci
      join messages m on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
      where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = any(${uuidArray(buyerIds)})
        and m.is_bot is not true
      order by ci.contact_id, coalesce(m.occurred_at, m.created_at) asc
    `)) as unknown as Array<{ contact_id: string; direction: string; content: string | null }>;
    return { buyers: buyerRows, messages: msgRows };
  });
  if (buyers.length === 0) return { indexed: 0 };

  // Group messages by contact_id (merges e.g. WA + IG identities of the same
  // contact into one conversation doc), then map each buyer to its conversation.
  const byContact = new Map<string, Array<{ direction: string; content: string | null }>>();
  for (const m of messages) {
    const arr = byContact.get(m.contact_id) ?? [];
    arr.push({ direction: m.direction, content: m.content });
    byContact.set(m.contact_id, arr);
  }
  const docs: { id: string; text: string; count: number; bought: string[] }[] = [];
  for (const b of buyers) {
    const rows = byContact.get(b.id) ?? [];
    const text = buildConversationText(rows);
    if (!text) continue;
    docs.push({ id: b.id, text, count: rows.length, bought: (b.bought ?? []).filter(Boolean) });
  }
  if (docs.length === 0) return { indexed: 0 };

  // Hundreds-to-thousands of docs now (not a dozen) — batch embedding calls and
  // upserts instead of sending everything in one request/query.
  const BATCH = 150;
  const batches = chunk(docs, BATCH);
  const vectors: number[][] = [];
  try {
    for (const batch of batches) {
      vectors.push(...(await embedTexts(batch.map((d) => d.text))));
    }
  } catch {
    return { indexed: 0 };
  }

  await withOrgCore(ctx, async (tx) => {
    let offset = 0;
    for (const batch of batches) {
      const batchVectors = vectors.slice(offset, offset + batch.length);
      offset += batch.length;
      const values = sql.join(
        batch.map(
          (d, i) =>
            sql`(current_setting('app.current_org_id', true), ${d.id}::uuid, ${toVectorLiteral(batchVectors[i])}::vector, ${d.count}, ${textArray(d.bought)}, ${d.text.slice(0, 120)}, now())`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        insert into crm_win_embeddings (org_id, contact_id, embedding, msg_count, bought, snippet, built_at)
        values ${values}
        on conflict (org_id, contact_id) do update set
          embedding = excluded.embedding, msg_count = excluded.msg_count,
          bought = excluded.bought, snippet = excluded.snippet, built_at = excluded.built_at
      `);
    }
  });

  // Generate + persist the AI breakdown of these winning conversations. Stored in
  // crm_settings (the last analysis is kept until the next rebuild, so the page
  // shows it instantly without re-calling the model). Best-effort.
  const analysis = await analyzeWins(docs);
  if (analysis) await persistWinAnalysis(ctx, analysis);

  return { indexed: docs.length };
}

/** Ask the model to distill winning conversations into wins + improvements. */
async function analyzeWins(
  docs: { text: string; bought: string[] }[],
): Promise<WinAnalysis | null> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey || docs.length === 0) return null;

  const sample = docs
    .slice(0, 20)
    .map((d, i) => {
      const bought = d.bought.length ? ` [purchased: ${d.bought.join(', ')}]` : '';
      return `### Conversation ${i + 1}${bought}\n${d.text.slice(0, 800).replace(/\s+/g, ' ').trim()}`;
    })
    .join('\n\n');

  const prompt = `You analyze WON sales conversations from a Peruvian aesthetics clinic (mostly Spanish): in each, the customer ended up purchasing a procedure. Across these winning conversations, identify the patterns that led to the sale.

Return ONLY a JSON object (no prose, no markdown fences):
{
  "wins": [{ "point": "what the clinic did well that drove the sale", "repeat": "how to repeat this with other customers" }],
  "improvements": [{ "area": "what could be better", "suggestions": ["concrete suggestion", "..."] }]
}
Give 3-5 "wins" and 2-4 "improvements" (each with 2-3 suggestions). Be specific and actionable. Write the content in Spanish (the clinic operates in Spanish).

Winning conversations:
${sample}`;

  try {
    const { object } = await generateObject({
      model: getOpenRouterModel(WIN_MODEL),
      schema: winAnalysisResultSchema,
      prompt,
      temperature: 0.3,
    });
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const wins = (object.wins ?? [])
      .map((w) => ({ point: str(w.point), repeat: str(w.repeat) }))
      .filter((w) => w.point)
      .slice(0, 6);
    const improvements = (object.improvements ?? [])
      .map((im) => ({
        area: str(im.area),
        suggestions: (im.suggestions ?? []).map(str).filter(Boolean).slice(0, 4),
      }))
      .filter((im) => im.area)
      .slice(0, 5);
    if (wins.length === 0 && improvements.length === 0) return null;
    return { wins, improvements, builtAt: new Date().toISOString(), basedOn: docs.length };
  } catch {
    return null; // leave the previous analysis in place
  }
}

/** Persist the analysis into crm_settings (shallow jsonb merge; coexists with accounts). */
async function persistWinAnalysis(ctx: CoreCtx, analysis: WinAnalysis): Promise<void> {
  const patch = JSON.stringify({ winAnalysis: analysis });
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(crmSettings)
      .values({ orgId: ctx.tenantId, value: { winAnalysis: analysis } })
      .onConflictDoUpdate({
        target: crmSettings.orgId,
        set: { value: sql`coalesce(${crmSettings.value}, '{}'::jsonb) || ${patch}::jsonb`, updatedAt: new Date() },
      }),
  );
}

/** The last-generated win analysis for the org (null if never built). */
export async function getWinAnalysis(ctx: CoreCtx): Promise<WinAnalysis | null> {
  try {
    return await withOrgCore(ctx, async (tx) => {
      const [row] = await tx
        .select({ value: crmSettings.value })
        .from(crmSettings)
        .where(eq(crmSettings.orgId, ctx.tenantId))
        .limit(1);
      const v = (row?.value ?? {}) as { winAnalysis?: WinAnalysis };
      return v.winAnalysis ?? null;
    });
  } catch {
    return null;
  }
}

export async function winIndexStatus(
  ctx: CoreCtx,
): Promise<{ count: number; builtAt: string | null; thin: boolean }> {
  if (!(await enabled(ctx))) return { count: 0, builtAt: null, thin: false };
  return withOrgCore(ctx, async (tx) => {
    const [r] = (await tx.execute(sql`
      select count(*)::int n, max(built_at) built, coalesce(avg(msg_count),0)::float8 avg_msgs
      from crm_win_embeddings where org_id = current_setting('app.current_org_id', true)
    `)) as unknown as Array<{ n: number; built: string | null; avg_msgs: number }>;
    const count = Number(r?.n ?? 0);
    return {
      count,
      builtAt: r?.built != null ? String(r.built) : null,
      thin: count > 0 && isThin(Number(r?.avg_msgs ?? 0)),
    };
  });
}

/** Nearest winning conversations to a contact's current conversation. */
export async function similarWins(ctx: CoreCtx, contactId: string, k = 3): Promise<SimilarWin[]> {
  if (!(await enabled(ctx))) return [];
  const conv = await conversationText(ctx, contactId);
  if (!conv.text) return [];
  let vec: number[];
  try {
    vec = await embedText(conv.text);
  } catch {
    return [];
  }
  const lit = toVectorLiteral(vec);
  const limit = Math.min(10, Math.max(1, k));
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select w.contact_id::text id, c.display_name, w.bought, coalesce(w.snippet,'') snippet,
             (1 - (w.embedding <=> ${lit}::vector))::float8 similarity
      from crm_win_embeddings w
      join crm_contacts c on c.id = w.contact_id
      where w.org_id = current_setting('app.current_org_id', true)
        and w.contact_id <> ${contactId} and w.embedding is not null
      order by w.embedding <=> ${lit}::vector
      limit ${sql.raw(String(limit))}
    `)) as unknown as Array<{
      id: string;
      display_name: string | null;
      bought: string[] | null;
      snippet: string;
      similarity: number;
    }>;
    return rows.map((r) => ({
      contactId: String(r.id),
      displayName: r.display_name != null ? String(r.display_name) : null,
      similarity: Number(r.similarity),
      bought: (r.bought ?? []).filter(Boolean),
      snippet: String(r.snippet),
    }));
  });
}
