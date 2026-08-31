import { eq, sql, type SQL } from 'drizzle-orm';
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
import { notDepositMatchSql, type DepositRule } from './crm-deposit-rule';
import {
  lockDepositConfig,
  readDepositConfigVersion,
  resolveDepositRuleWithVersion,
} from './crm-settings.service';

const winAnalysisResultSchema = z.object({
  wins: z
    .array(
      z.object({
        point: z.string(),
        repeat: z.string(),
        /** Evidence refs (e.g. "c3") into the excerpt list offered in the prompt. */
        evidence: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  improvements: z
    .array(z.object({ area: z.string(), suggestions: z.array(z.string()).optional() }))
    .optional(),
});

const WIN_MODEL =
  env.CRM_FUNNEL_MODEL ||
  env.CRM_SENTIMENT_MODEL ||
  env.NOTES_POLISH_MODEL ||
  'google/gemini-2.5-flash';

/** A conversation excerpt (Master-Brain corpus chunk) that justifies a win point. */
export interface WinSource {
  contactId: string;
  name: string | null;
  occurredAt: string | null;
}

/** AI breakdown of winning conversations — persisted in crm_settings.winAnalysis. */
export interface WinAnalysis {
  /** What worked + how to repeat it with other customers. */
  wins: { point: string; repeat: string; sources?: WinSource[] }[];
  /** Where to improve + concrete suggestions. */
  improvements: { area: string; suggestions: string[] }[];
  builtAt: string;
  basedOn: number;
  /** True when the analysis was grounded in the Master-Brain vector corpus. */
  fromCorpus?: boolean;
  /** Rebuild generation whose complete index snapshot this analysis describes. */
  generation?: string;
}

/**
 * A bought line: present AND not a booking deposit, under the ORG'S rule
 * (crm_settings.value.deposit). Rule-parameterized rather than module-level:
 * `bought`/`snippet` computed from it are MATERIALIZED into
 * crm_win_embeddings, so one tenant's vocabulary must never be baked in at
 * import time and reused for the next.
 */
const isProcedureSql = (rule: DepositRule) =>
  sql`(ii.description is not null and ${notDepositMatchSql('ii.description', rule)})`;

/** Bind a JS string[] as a real Postgres text[] (each element parameterized). */
function textArray(arr: string[]) {
  if (arr.length === 0) return sql`array[]::text[]`;
  return sql`array[${sql.join(
    arr.map((x) => sql`${x}`),
    sql`, `,
  )}]::text[]`;
}

/** Bind a JS string[] of uuids as a real Postgres uuid[] (each element parameterized). */
function uuidArray(arr: string[]) {
  if (arr.length === 0) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(
    arr.map((x) => sql`${x}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

/** Reconcile the removal half of a complete win-index publication. The caller
 * must hold the org deposit-config transaction lock before invoking this. */
export async function deleteMissingWinEmbeddings(
  tx: { execute: (query: SQL) => Promise<unknown> },
  currentContactIds: string[],
): Promise<void> {
  await tx.execute(sql`
    delete from crm_win_embeddings
    where org_id = current_setting('app.current_org_id', true)
      and contact_id <> all(${uuidArray(currentContactIds)})
  `);
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
async function conversationText(
  ctx: CoreCtx,
  contactId: string,
): Promise<{ text: string; count: number }> {
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

/** `buildWinIndex`'s outcome. `skipped: 'rule-changed'` marks the one case
 *  where a completed pass is deliberately discarded rather than published:
 *  the org's deposit rule changed after this pass classified its buyers. */
export interface BuildWinIndexResult {
  indexed: number;
  skipped?: 'rule-changed' | 'newer-build';
}

/** Mint the latest requested generation without changing the published snapshot. */
async function beginWinIndexGeneration(ctx: CoreCtx): Promise<string> {
  const generation = crypto.randomUUID();
  return withOrgCore(ctx, async (tx) => {
    await lockDepositConfig(tx, ctx.tenantId);
    await tx.execute(sql`
      insert into crm_settings (org_id, value, updated_at)
      values (${ctx.tenantId}, jsonb_build_object('winIndexRequestedGeneration', ${generation}), now())
      on conflict (org_id) do update
      set value = coalesce(crm_settings.value, '{}'::jsonb)
            || jsonb_build_object('winIndexRequestedGeneration', ${generation}),
          updated_at = now()
    `);
    return generation;
  });
}

async function readWinIndexRequestedGeneration(
  tx: { execute: (query: SQL) => Promise<unknown> },
  orgId: string,
): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    select value->>'winIndexRequestedGeneration' as generation
    from crm_settings where org_id = ${orgId}
  `)) as unknown as Array<{ generation: string | null }>;
  return row?.generation ?? null;
}

async function readWinIndexGeneration(
  tx: { execute: (query: SQL) => Promise<unknown> },
  orgId: string,
): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    select value->>'winIndexGeneration' as generation
    from crm_settings where org_id = ${orgId}
  `)) as unknown as Array<{ generation: string | null }>;
  return row?.generation ?? null;
}

/**
 * (Re)build the winning-conversation index: embed each procedure-buyer's
 * conversation and upsert it. Idempotent; re-embeds all buyers on every call.
 *
 * Buyers are matched via the party-spine (crm_contacts.party_id →
 * fin_clients.party_id) — reliable across ALL channels, unlike the old
 * phone-number match hard-filtered to WhatsApp (which missed nearly every
 * buyer and all Instagram conversations).
 *
 * The deposit rule is read ONCE, up front, and rechecked under the org's
 * deposit-config lock at publication time — a pass whose rule was replaced
 * mid-flight is discarded, never published. See the publication block below.
 */
export async function buildWinIndex(ctx: CoreCtx): Promise<BuildWinIndexResult> {
  if (!(await enabled(ctx))) return { indexed: 0 };
  const generation = await beginWinIndexGeneration(ctx);
  // ONE settings read per rebuild — the vocabulary that decides what lands in
  // crm_win_embeddings.bought for every buyer in this pass. Its VERSION is
  // carried to the publication step below and rechecked there: everything
  // between here and that upsert (the embedding round-trips especially) is
  // time in which an operator can change the rule out from under this pass.
  const { rule, version: ruleVersion } = await resolveDepositRuleWithVersion(ctx);
  const IS_PROCEDURE = isProcedureSql(rule);

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
    if (buyerRows.length === 0)
      return {
        buyers: buyerRows,
        messages: [] as Array<{
          contact_id: string;
          direction: string;
          content: string | null;
          at: string | null;
        }>,
      };
    const buyerIds = buyerRows.map((b) => b.id);
    const msgRows = (await tx.execute(sql`
      select ci.contact_id::text contact_id, m.direction, m.content,
             coalesce(m.occurred_at, m.created_at) as at
      from crm_contact_identities ci
      join messages m on m.org_id = ci.org_id and m.channel = ci.channel and m.chat_id = ci.external_id
      where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = any(${uuidArray(buyerIds)})
        and m.is_bot is not true
      order by ci.contact_id, coalesce(m.occurred_at, m.created_at) asc
    `)) as unknown as Array<{
      contact_id: string;
      direction: string;
      content: string | null;
      at: string | null;
    }>;
    return { buyers: buyerRows, messages: msgRows };
  });
  // Group messages by contact_id (merges e.g. WA + IG identities of the same
  // contact into one conversation doc), then map each buyer to its conversation.
  const byContact = new Map<string, Array<{ direction: string; content: string | null }>>();
  const lastAt = new Map<string, string>();
  for (const m of messages) {
    const arr = byContact.get(m.contact_id) ?? [];
    arr.push({ direction: m.direction, content: m.content });
    byContact.set(m.contact_id, arr);
    if (m.at) lastAt.set(m.contact_id, m.at); // rows arrive chronological — last write wins
  }
  const docs: {
    id: string;
    text: string;
    count: number;
    bought: string[];
    lastAt: string | null;
  }[] = [];
  for (const b of buyers) {
    const rows = byContact.get(b.id) ?? [];
    const text = buildConversationText(rows);
    if (!text) continue;
    docs.push({
      id: b.id,
      text,
      count: rows.length,
      bought: (b.bought ?? []).filter(Boolean),
      lastAt: lastAt.get(b.id) ?? null,
    });
  }
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

  const published = await withOrgCore(ctx, async (tx) => {
    // PUBLICATION — the step that makes this pass's classification visible to
    // the CRM insights surfaces. It runs under the deposit-config lock so the
    // recheck below and the upsert are one indivisible step against a
    // concurrent `writeDepositRule` (see `lockDepositConfig`).
    await lockDepositConfig(tx, ctx.tenantId);
    if ((await readWinIndexRequestedGeneration(tx, ctx.tenantId)) !== generation) {
      return 'newer-build' as const;
    }
    const liveVersion = await readDepositConfigVersion(tx, ctx.tenantId);
    if (liveVersion !== ruleVersion) {
      // The rule changed while this pass was embedding. `bought`/`snippet`
      // here were classified under the OLD vocabulary; writing them now would
      // stamp them `built_at = now()` — NEWER than the new rule's `updatedAt`
      // — and `writeDepositRule`'s staleness disclosure would then report
      // semantically stale rows as fresh. Drop this pass instead: the rows
      // already in the table keep their older `built_at`, so they stay
      // correctly counted as stale and the operator is still told to rebuild.
      console.warn(
        `crm-similarity: deposit rule for org ${ctx.tenantId} changed during the win-index ` +
          `rebuild (snapshot ${ruleVersion ?? 'default'} → live ${liveVersion ?? 'default'}); ` +
          `discarding this pass rather than publishing classifications built under the old rule`,
      );
      return 'rule-changed' as const;
    }
    // A rebuild publishes the COMPLETE current set, not merely additions. In
    // particular, a broadened deposit rule can make a formerly qualifying
    // contact disappear from `docs`; remove that old row in the same locked
    // transaction as the upserts. The empty set deliberately clears the org.
    await deleteMissingWinEmbeddings(
      tx,
      docs.map((d) => d.id),
    );
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
    // The index snapshot is now authoritative. Invalidate the previous
    // snapshot's analysis in the same transaction, including for an empty
    // publication and when the best-effort model call below later fails.
    await tx.execute(sql`
      update crm_settings
      set value = (coalesce(value, '{}'::jsonb) - 'winAnalysis')
            || jsonb_build_object('winIndexGeneration', ${generation}),
          updated_at = now()
      where org_id = ${ctx.tenantId}
    `);
    return null;
  });
  // Nothing was published, so there is nothing to analyze either — the
  // breakdown would describe buyers classified under a rule the org has
  // already replaced.
  if (published) return { indexed: 0, skipped: published };

  // Generate + persist the AI breakdown of these winning conversations. Stored in
  // crm_settings (the last analysis is kept until the next rebuild, so the page
  // shows it instantly without re-calling the model). Best-effort.
  const analysis = await analyzeWins(ctx, docs);
  if (analysis) await persistWinAnalysisIfCurrent(ctx, analysis, ruleVersion, generation);

  return { indexed: docs.length };
}

interface WinExcerpt {
  ref: string; // "c1", "c2", … — what the model cites
  contactId: string;
  name: string | null;
  occurredAt: string | null;
  text: string;
  bought: string[];
}

/**
 * Load winning-conversation excerpts from the Master-Brain corpus
 * (`knowledge_documents`/`knowledge_chunks` — the org's canonical all-source
 * vector store; Master Brain membership is implicit) for the given buyer
 * contacts, most recent first. Conversation documents carry the chat id in
 * their metadata (chunk metadata does not, reliably), so the join goes
 * contact identity → document → chunks. Capped per contact so one long chat
 * can't crowd others out.
 */
async function loadWinExcerpts(
  ctx: CoreCtx,
  buyers: { id: string; bought: string[] }[],
): Promise<WinExcerpt[]> {
  const ids = buyers.map((b) => b.id);
  const rows = await withOrgCore(ctx, async (tx) => {
    return (await tx.execute(sql`
      select ci.contact_id::text contact_id, c.display_name, k.chunk_text,
             to_char(k.occurred_at, 'YYYY-MM-DD') occurred_at
      from crm_contact_identities ci
      join crm_contacts c on c.id = ci.contact_id
      join knowledge_documents d on d.org_id = ci.org_id and d.metadata->>'chatId' = ci.external_id
      join knowledge_chunks k on k.org_id = d.org_id and k.document_id = d.id
      where ci.org_id = current_setting('app.current_org_id', true)
        and ci.contact_id = any(${uuidArray(ids)})
      order by k.occurred_at desc nulls last
      limit 150
    `)) as unknown as Array<{
      contact_id: string;
      display_name: string | null;
      chunk_text: string;
      occurred_at: string | null;
    }>;
  });

  const boughtBy = new Map(buyers.map((b) => [b.id, b.bought]));
  const perContact = new Map<string, number>();
  const excerpts: WinExcerpt[] = [];
  for (const r of rows) {
    const used = perContact.get(r.contact_id) ?? 0;
    if (used >= 2) continue; // ponytail: 2 chunks/contact keeps the prompt broad, not deep
    perContact.set(r.contact_id, used + 1);
    excerpts.push({
      ref: `c${excerpts.length + 1}`,
      contactId: r.contact_id,
      name: r.display_name != null ? String(r.display_name) : null,
      occurredAt: r.occurred_at != null ? String(r.occurred_at) : null,
      text: String(r.chunk_text),
      bought: boughtBy.get(r.contact_id) ?? [],
    });
    if (excerpts.length >= 40) break;
  }
  return excerpts;
}

/**
 * Ask the model to distill winning conversations into wins + improvements.
 * Grounded in the Master-Brain corpus: excerpts are the most recent vectorized
 * chat chunks of buyer conversations, each carrying a ref the model must cite
 * as evidence — cited refs become clickable sources on the insights page.
 * Falls back to raw message-table transcripts (recency-sorted, no sources)
 * when the corpus has no chunks for these buyers yet.
 */
async function analyzeWins(
  ctx: CoreCtx,
  docs: { id: string; text: string; bought: string[]; lastAt: string | null }[],
): Promise<WinAnalysis | null> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey || docs.length === 0) return null;

  // Most recently active buyers first — recent wins reflect the current playbook.
  const recent = [...docs].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));

  let excerpts: WinExcerpt[] = [];
  try {
    excerpts = await loadWinExcerpts(ctx, recent.slice(0, 25));
  } catch {
    excerpts = []; // corpus unavailable — fall back below
  }
  const fromCorpus = excerpts.length > 0;

  const sample = fromCorpus
    ? excerpts
        .map((e) => {
          const bought = e.bought.length ? ` [purchased: ${e.bought.join(', ')}]` : '';
          const when = e.occurredAt ? ` (${e.occurredAt})` : '';
          return `### [${e.ref}]${when}${bought}\n${e.text.slice(0, 700).replace(/\s+/g, ' ').trim()}`;
        })
        .join('\n\n')
    : recent
        .slice(0, 20)
        .map((d, i) => {
          const bought = d.bought.length ? ` [purchased: ${d.bought.join(', ')}]` : '';
          return `### Conversation ${i + 1}${bought}\n${d.text.slice(0, 800).replace(/\s+/g, ' ').trim()}`;
        })
        .join('\n\n');

  const evidenceInstruction = fromCorpus
    ? `Each excerpt has an id like [c3]. For every "win", include "evidence": the ids of the excerpts (1-3) that best justify it — only ids from the list, prefer the most recent.`
    : '';
  const prompt = `You analyze WON sales conversations from a Peruvian aesthetics clinic (mostly Spanish): in each, the customer ended up purchasing a procedure. Across these winning conversations, identify the patterns that led to the sale.

Return ONLY a JSON object (no prose, no markdown fences):
{
  "wins": [{ "point": "what the clinic did well that drove the sale", "repeat": "how to repeat this with other customers", "evidence": ["c1"] }],
  "improvements": [{ "area": "what could be better", "suggestions": ["concrete suggestion", "..."] }]
}
Give 3-5 "wins" and 2-4 "improvements" (each with 2-3 suggestions). Be specific and actionable. ${evidenceInstruction} Write the content in Spanish (the clinic operates in Spanish).

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
    const byRef = new Map(excerpts.map((e) => [e.ref, e]));
    const wins = (object.wins ?? [])
      .map((w) => {
        // Clamp citations to refs actually offered (rejects invented ids), then
        // dedupe by contact so one win never links the same customer twice.
        const seen = new Set<string>();
        const sources: WinSource[] = [];
        for (const ref of w.evidence ?? []) {
          const e = byRef.get(str(ref));
          if (!e || seen.has(e.contactId)) continue;
          seen.add(e.contactId);
          sources.push({ contactId: e.contactId, name: e.name, occurredAt: e.occurredAt });
          if (sources.length >= 3) break;
        }
        return { point: str(w.point), repeat: str(w.repeat), sources };
      })
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
    return {
      wins,
      improvements,
      builtAt: new Date().toISOString(),
      basedOn: docs.length,
      fromCorpus,
    };
  } catch {
    return null; // the publication already invalidated the previous generation's analysis
  }
}

/** Persist the analysis into crm_settings (shallow jsonb merge; coexists with accounts). */
export async function persistWinAnalysisIfCurrent(
  ctx: CoreCtx,
  analysis: WinAnalysis,
  ruleVersion: string | null,
  generation: string,
): Promise<boolean> {
  const versionedAnalysis = { ...analysis, generation };
  const patch = JSON.stringify({ winAnalysis: versionedAnalysis });
  return withOrgCore(ctx, async (tx) => {
    await lockDepositConfig(tx, ctx.tenantId);
    if ((await readDepositConfigVersion(tx, ctx.tenantId)) !== ruleVersion) return false;
    if ((await readWinIndexGeneration(tx, ctx.tenantId)) !== generation) return false;
    await tx
      .insert(crmSettings)
      .values({ orgId: ctx.tenantId, value: { winAnalysis: versionedAnalysis } })
      .onConflictDoUpdate({
        target: crmSettings.orgId,
        set: {
          value: sql`coalesce(${crmSettings.value}, '{}'::jsonb) || ${patch}::jsonb`,
          updatedAt: new Date(),
        },
      });
    return true;
  });
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
      const settings = (row?.value ?? {}) as {
        winAnalysis?: WinAnalysis;
        winIndexGeneration?: unknown;
      };
      return settings.winAnalysis?.generation === settings.winIndexGeneration
        ? (settings.winAnalysis ?? null)
        : null;
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
