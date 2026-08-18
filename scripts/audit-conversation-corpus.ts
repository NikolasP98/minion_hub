#!/usr/bin/env bun
/**
 * THROWAWAY read-only audit (WP-0, spec 2026-07-17-crm-conversation-intelligence-spec.md).
 * Not committed. Answers, per org:
 *   (a) sender_id == chat_id join-key ratio per channel (decides WP-A's join key)
 *   (b) corpus size (rows + distinct conversations) per channel
 *   (c) content coverage % per channel
 *   (d) rough embedding cost estimate
 *
 * Connects directly with `postgres` (no SvelteKit/$server import graph needed —
 * this is raw SQL only) using SUPABASE_DB_URL from .env.local, mirroring the
 * `set local role app_ledger` + org GUC that `withOrg()` uses in
 * src/server/db/pg-ledger-client.ts.
 *
 *   bun scripts/audit-conversation-corpus.ts [orgId]
 */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const CHANNELS = ['instagram', 'whatsapp', 'telegram'] as const;

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local)');
const client = postgres(url, { prepare: false, max: 2 });

async function withOrg<T>(
  orgId: string,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return client.begin(async (tx) => {
    await tx`set local role app_ledger`;
    await tx`select set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });
}

async function main() {
  const orgId = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? FACES_ORG;

  const orgs = await client`select id, name from organizations order by created_at asc`;
  console.log(`# Conversation corpus audit — org \`${orgId}\``);
  console.log('');
  console.log(
    `(${orgs.length} org(s) in DB: ${orgs.map((o) => `${o.name}(${String(o.id).slice(0, 8)})`).join(', ')})`,
  );
  console.log('');

  await withOrg(orgId, async (tx) => {
    // (a) join-key check
    console.log('## (a) sender_id == chat_id join-key ratio (inbound only)');
    console.log('');
    console.log('| channel | same | total | ratio |');
    console.log('|---|--:|--:|--:|');
    for (const ch of CHANNELS) {
      const [row] = await tx`
        select count(*) filter (where sender_id = chat_id) as same, count(*) as total
        from messages
        where channel = ${ch} and direction = 'inbound'
      `;
      const same = Number(row.same);
      const total = Number(row.total);
      const ratio = total > 0 ? ((same / total) * 100).toFixed(1) : 'n/a';
      console.log(`| ${ch} | ${same} | ${total} | ${ratio}% |`);
    }
    console.log('');

    // (b) corpus size + (c) content coverage, per channel
    console.log('## (b)+(c) corpus size & content coverage (all directions)');
    console.log('');
    console.log(
      '| channel | total rows | non-bot w/ content | inbound rows | inbound w/ content | content coverage % | distinct (channel,chat_id) |',
    );
    console.log('|---|--:|--:|--:|--:|--:|--:|');
    let totalConvos = 0;
    for (const ch of CHANNELS) {
      const [row] = await tx`
        select
          count(*) as total_rows,
          count(*) filter (where coalesce(content,'') <> '' and is_bot is not true) as content_rows,
          count(*) filter (where direction = 'inbound') as inbound_rows,
          count(*) filter (where direction = 'inbound' and coalesce(content,'') <> '') as inbound_with_content,
          count(distinct chat_id) as distinct_chats
        from messages
        where channel = ${ch}
      `;
      const inboundRows = Number(row.inbound_rows);
      const inboundWithContent = Number(row.inbound_with_content);
      const coverage =
        inboundRows > 0 ? ((inboundWithContent / inboundRows) * 100).toFixed(1) : 'n/a';
      totalConvos += Number(row.distinct_chats);
      console.log(
        `| ${ch} | ${row.total_rows} | ${row.content_rows} | ${inboundRows} | ${inboundWithContent} | ${coverage}% | ${row.distinct_chats} |`,
      );
    }
    const [allChats] = await tx`
      select count(distinct (channel, chat_id)) as n from messages where channel = any(${CHANNELS as unknown as string[]})
    `;
    console.log('');
    console.log(
      `Distinct \`(channel, chat_id)\` conversations across the 3 channels: **${allChats.n}** (sum-of-per-channel was ${totalConvos} — should match since chat_id is not shared cross-channel).`,
    );
    console.log('');

    // (d) rough embedding cost
    console.log('## (d) rough embedding cost estimate');
    console.log('');
    const [charsRow] = await tx`
      select coalesce(sum(length(content)), 0) as total_chars, count(*) as n
      from messages
      where channel = any(${CHANNELS as unknown as string[]}) and is_bot is not true and coalesce(content,'') <> ''
    `;
    const totalChars = Number(charsRow.total_chars);
    const estTokens = totalChars / 4;
    const estCostUsd = (estTokens / 1000) * 0.00002;
    console.log(
      `Rows counted: ${charsRow.n}. Total content chars: ${totalChars.toLocaleString()}.`,
    );
    console.log(`Est. tokens (chars/4): ${Math.round(estTokens).toLocaleString()}.`);
    console.log(
      `Est. embedding cost @ $0.00002/1k tok (text-embedding-3-small): **$${estCostUsd.toFixed(4)}**.`,
    );
    console.log(
      '(Real backfill will chunk to ~1500 tok/conversation, not per-message — this is a raw content-volume upper bound, not the exact chunk count.)',
    );
    console.log('');
  });

  // (extra) disabled_channels scope check
  const settings = await client`select org_id, value from crm_settings where org_id = ${orgId}`;
  console.log('## crm_settings.disabled_channels (harvest scope gate)');
  console.log('');
  if (settings.length === 0) {
    console.log('No `crm_settings` row for this org → all channels enabled (default).');
  } else {
    console.log('```json');
    console.log(JSON.stringify(settings[0].value, null, 2));
    console.log('```');
  }
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
