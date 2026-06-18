import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';
import { embedText, embedTexts, embeddingsEnabled, toVectorLiteral } from './embeddings';
import { buildConversationText, isThin } from '$lib/components/crm/crm-similarity';

const PHONE9 = (col: string) => sql.raw(`right(regexp_replace(coalesce(${col},''),'\\D','','g'), 9)`);
const IS_PROCEDURE = sql.raw(`(ii.description is not null and ii.description not ilike '%reserva%')`);

/** Bind a JS string[] as a real Postgres text[] (each element parameterized). */
function textArray(arr: string[]) {
  if (arr.length === 0) return sql`array[]::text[]`;
  return sql`array[${sql.join(arr.map((x) => sql`${x}`), sql`, `)}]::text[]`;
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
 * conversation and upsert it. Idempotent; N is tiny so we re-embed all.
 */
export async function buildWinIndex(ctx: CoreCtx): Promise<{ indexed: number }> {
  if (!(await enabled(ctx))) return { indexed: 0 };

  // Buyers + their conversations in a SINGLE round-trip each (not per-contact):
  // (1) procedure-buyers with bought procedures, (2) every message for those
  // chats. Grouping happens in JS — avoids O(buyers) sequential queries.
  const { buyers, messages } = await withOrgCore(ctx, async (tx) => {
    const buyerRows = (await tx.execute(sql`
      with phones as (
        select ci.contact_id, ci.external_id, ${PHONE9('ci.external_id')} p9
        from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.channel = 'whatsapp'
          and length(${PHONE9('ci.external_id')}) >= 8
      )
      select ph.contact_id::text id, ph.external_id,
             array_agg(distinct ii.description) filter (where ${IS_PROCEDURE}) bought
      from phones ph
      join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} = ph.p9
      join fin_invoices fi on fi.client_id = fc.id
      join fin_invoice_items ii on ii.invoice_id = fi.id
      group by ph.contact_id, ph.external_id
      having bool_or(${IS_PROCEDURE})
    `)) as unknown as Array<{ id: string; external_id: string; bought: string[] | null }>;
    if (buyerRows.length === 0) return { buyers: buyerRows, messages: [] as Array<{ chat_id: string; direction: string; content: string | null }> };
    const chatIds = [...new Set(buyerRows.map((b) => b.external_id))];
    const msgRows = (await tx.execute(sql`
      select m.chat_id, m.direction, m.content
      from messages m
      where m.org_id = current_setting('app.current_org_id', true) and m.channel = 'whatsapp'
        and m.is_bot is not true and m.chat_id in ${chatIds}
      order by m.chat_id, coalesce(m.occurred_at, m.created_at) asc
    `)) as unknown as Array<{ chat_id: string; direction: string; content: string | null }>;
    return { buyers: buyerRows, messages: msgRows };
  });
  if (buyers.length === 0) return { indexed: 0 };

  // Group messages by chat_id, then map each buyer to its conversation.
  const byChat = new Map<string, Array<{ direction: string; content: string | null }>>();
  for (const m of messages) {
    const arr = byChat.get(m.chat_id) ?? [];
    arr.push({ direction: m.direction, content: m.content });
    byChat.set(m.chat_id, arr);
  }
  const docs: { id: string; text: string; count: number; bought: string[] }[] = [];
  for (const b of buyers) {
    const rows = byChat.get(b.external_id) ?? [];
    const text = buildConversationText(rows);
    if (!text) continue;
    docs.push({ id: b.id, text, count: rows.length, bought: (b.bought ?? []).filter(Boolean) });
  }
  if (docs.length === 0) return { indexed: 0 };

  let vectors: number[][];
  try {
    vectors = await embedTexts(docs.map((d) => d.text));
  } catch {
    return { indexed: 0 };
  }

  // One set-based upsert (not N sequential round-trips).
  await withOrgCore(ctx, async (tx) => {
    const values = sql.join(
      docs.map(
        (d, i) =>
          sql`(current_setting('app.current_org_id', true), ${d.id}::uuid, ${toVectorLiteral(vectors[i])}::vector, ${d.count}, ${textArray(d.bought)}, ${d.text.slice(0, 120)}, now())`,
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
  });
  return { indexed: docs.length };
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
