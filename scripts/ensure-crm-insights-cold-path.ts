#!/usr/bin/env bun
/**
 * Pre-deploy gate for the large-table CRM Insights indexes. The normal Hub
 * migration runner is transactional, while PostgreSQL requires CONCURRENTLY
 * outside a transaction to avoid blocking message writes.
 *
 * Inspect: bun run db:crm-insights-cold-path
 * Apply + require populated rollups:
 *   bun run db:crm-insights-cold-path --apply --require-prewarm
 */
import postgres from 'postgres';

const apply = process.argv.includes('--apply');
const requirePrewarm = process.argv.includes('--require-prewarm');
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL is not set');

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  application_name: 'minion-crm-insights-cold-path',
  onnotice: () => {},
});

const indexDefinitions = [
  `create index concurrently if not exists messages_crm_insights_inbound_time_idx
     on public.messages (org_id, (coalesce(occurred_at, created_at)))
     where direction = 'inbound' and is_bot is not true`,
  `create index concurrently if not exists messages_crm_insights_rollup_time_idx
     on public.messages ((coalesce(occurred_at, created_at)))
     where direction = 'inbound' and is_bot is not true
       and content is not null and length(trim(content)) > 0`,
];

async function indexState() {
  return sql<Array<{ name: string; valid: boolean; ready: boolean; bytes: string }>>`
    select index_class.relname as name,
           index_meta.indisvalid as valid,
           index_meta.indisready as ready,
           pg_relation_size(index_class.oid)::bigint::text as bytes
    from pg_class index_class
    join pg_index index_meta on index_meta.indexrelid = index_class.oid
    join pg_namespace namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public'
      and index_class.relname in (
        'messages_crm_insights_inbound_time_idx',
        'messages_crm_insights_rollup_time_idx'
      )
    order by index_class.relname
  `;
}

try {
  const before = await indexState();
  if (apply) {
    await sql`set lock_timeout = '5s'`;
    await sql`set statement_timeout = '15min'`;
    for (const definition of indexDefinitions) await sql.unsafe(definition);
  }
  const after = await indexState();
  const [{ word_table: wordTable, sentiment_table: sentimentTable }] = await sql<
    Array<{ word_table: boolean; sentiment_table: boolean }>
  >`
    select to_regclass('public.crm_word_frequency_daily') is not null as word_table,
           to_regclass('public.crm_sentiment_chat_daily') is not null as sentiment_table
  `;
  const [word] = wordTable
    ? await sql<Array<{ rows: string; min_day: string | null; max_day: string | null }>>`
        select count(*)::bigint::text as rows, min(day)::text as min_day, max(day)::text as max_day
        from public.crm_word_frequency_daily
      `
    : [{ rows: '0', min_day: null, max_day: null }];
  const [sentiment] = sentimentTable
    ? await sql<Array<{ rows: string; min_day: string | null; max_day: string | null }>>`
        select count(*)::bigint::text as rows, min(day)::text as min_day, max(day)::text as max_day
        from public.crm_sentiment_chat_daily
      `
    : [{ rows: '0', min_day: null, max_day: null }];

  const validIndexes = after.filter((index) => index.valid && index.ready).length;
  if (apply && validIndexes !== indexDefinitions.length) {
    throw new Error(`CRM Insights index gate failed: ${validIndexes}/${indexDefinitions.length}`);
  }
  if (requirePrewarm && (Number(word.rows) === 0 || Number(sentiment.rows) === 0)) {
    throw new Error('CRM Insights rollup prewarm gate failed');
  }
  console.log(JSON.stringify({ apply, requirePrewarm, before, after, word, sentiment }));
} finally {
  await sql.end({ timeout: 5 });
}
