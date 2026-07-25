#!/usr/bin/env bun
/**
 * Build the all-channel conversation corpus scan index without blocking
 * message ingest. The Hub migration runner is transactional, while PostgreSQL
 * requires CREATE INDEX CONCURRENTLY to run outside a transaction.
 *
 * Inspect: bun run db:conversation-index
 * Apply:   bun run db:conversation-index --apply
 */
import postgres from 'postgres';

const INDEX_NAME = 'messages_conversation_corpus_scan_idx';
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL?.trim();

if (!url) throw new Error('SUPABASE_DB_URL is not set');

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  application_name: 'minion-conversation-corpus-index',
  onnotice: () => {},
});

try {
  const [normalization] = await sql<
    Array<{ dirty_channel: number; dirty_account: number; rows: number }>
  >`
    select
      count(*) filter (where channel is distinct from lower(trim(channel)))::int
        as dirty_channel,
      count(*) filter (
        where account_id is not null and account_id is distinct from trim(account_id)
      )::int as dirty_account,
      count(*)::int as rows
    from public.messages
  `;
  const [before] = await sql<Array<{ valid: boolean; ready: boolean; bytes: string }>>`
    select index_meta.indisvalid as valid, index_meta.indisready as ready,
      pg_relation_size(index_class.oid)::bigint::text as bytes
    from pg_class index_class
    join pg_index index_meta on index_meta.indexrelid = index_class.oid
    join pg_namespace namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public' and index_class.relname = ${INDEX_NAME}
  `;

  if (apply) {
    if (normalization?.dirty_channel !== 0 || normalization.dirty_account !== 0) {
      throw new Error('message channel/account normalization gate failed');
    }
    await sql`set lock_timeout = '5s'`;
    await sql`set statement_timeout = '15min'`;
    await sql.unsafe(`
      create index concurrently if not exists ${INDEX_NAME}
      on public.messages (
        org_id,
        lower(trim(channel)),
        coalesce(nullif(trim(account_id), ''), 'default'),
        chat_id,
        coalesce(occurred_at, created_at),
        id
      )
      where nullif(trim(chat_id), '') is not null
        and coalesce(is_group, false) = false
        and is_bot is not true
        and nullif(trim(content), '') is not null
    `);
  }

  const [after] = await sql<Array<{ valid: boolean; ready: boolean; bytes: string }>>`
    select index_meta.indisvalid as valid, index_meta.indisready as ready,
      pg_relation_size(index_class.oid)::bigint::text as bytes
    from pg_class index_class
    join pg_index index_meta on index_meta.indexrelid = index_class.oid
    join pg_namespace namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public' and index_class.relname = ${INDEX_NAME}
  `;
  console.log(
    JSON.stringify({ apply, normalization, before: before ?? null, after: after ?? null }),
  );
} finally {
  await sql.end({ timeout: 5 });
}
