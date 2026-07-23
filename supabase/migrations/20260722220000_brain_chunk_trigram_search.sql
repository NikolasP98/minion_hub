-- Indexed single-token spelling candidates for Brain hybrid retrieval.
--
-- The service query uses the exact expression below:
--   lower(knowledge_chunks.chunk_text) %> $query_token
-- `%>` is the indexed commutator for query_token <% lower(chunk_text), so the
-- GIN index supplies a bounded candidate set before deterministic edit-distance
-- policy decides whether a result is actually relevant.
-- This is intentionally a normal (not concurrent) migration index build because
-- the migration runner owns the transaction. Schedule deployment for a quiet
-- ingestion window; building the GIN index holds a write-blocking table lock.

create extension if not exists pg_trgm;

create index if not exists knowledge_chunks_chunk_text_trgm_gin
  on public.knowledge_chunks
  using gin (lower(chunk_text) gin_trgm_ops);

comment on index public.knowledge_chunks_chunk_text_trgm_gin is
  'Supports bounded Brain word-similarity candidates via lower(chunk_text) %> query token';
