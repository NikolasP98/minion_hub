-- Covering partial index for the CRM rank query's per-contact message rollup
-- (the `agg` CTE in crm-contacts.service.ts). EXPLAIN-proven on prod
-- 2026-08-22: the aggregation heap-fetched ~117k random rows from the 1.2GB
-- messages heap per run (49.5s); with this index it is an index-only scan
-- (0 heap fetches, 662ms). Already applied to prod via
-- `create index concurrently` (no write lock); IF NOT EXISTS makes this
-- migration a no-op there while fresh replays still get the index.
create index if not exists messages_crm_agg_covering_idx
  on public.messages (org_id, channel, chat_id)
  include (occurred_at, created_at, direction)
  where is_bot is not true;
