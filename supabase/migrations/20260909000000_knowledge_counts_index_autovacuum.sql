-- /brains source stats: the per-source "unembedded chunks" count was a seq scan
-- over the chunk heap (vector column, ~1 GB) and index-only counts paid tens of
-- thousands of heap fetches because autovacuum at the default 20% scale factor
-- left the visibility map stale for weeks on these hot tables.
create index if not exists knowledge_chunks_org_source_unembedded_idx
  on public.knowledge_chunks (org_id, source_id)
  where embedding is null;

alter table public.knowledge_chunks set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);
alter table public.knowledge_documents set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);
