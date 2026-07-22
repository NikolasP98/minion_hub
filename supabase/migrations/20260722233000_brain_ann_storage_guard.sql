-- Keep ANN acceleration optional while the production database operates under
-- its current storage ceiling. Both corpora retain their canonical embeddings;
-- PostgreSQL falls back to exact cosine scans when these indexes are absent.
-- Reintroduce an ANN index only after a measured storage-capacity change.
set local lock_timeout = '5s';

drop index if exists public.knowledge_chunks_embedding_hnsw;
drop index if exists public.crm_conversation_chunks_embedding_ivfflat;
drop index if exists public.messages_message_id_idx;
drop index if exists public.agent_memories_embedding_hnsw;

comment on table public.knowledge_chunks is
  'Changed-chunk-only lexical and vector evidence shared across brain scopes. Embeddings remain canonical; ANN indexing is optional and currently disabled by the storage guard migration.';

comment on table public.crm_conversation_chunks is
  'Semantic retrieval corpus for CRM Conversation Intelligence: role-tagged, chunked (~1500 tok), embedded (1536-dim) 1:1 conversation text. RLS via app_ledger + app.current_org_id GUC (withOrgCore). Exact cosine retrieval remains available; the optional IVFFlat accelerator is disabled by the storage guard migration.';
