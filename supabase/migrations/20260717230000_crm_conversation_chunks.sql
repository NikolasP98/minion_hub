-- CRM Conversation Intelligence (WP-A) — semantic retrieval corpus.
--
-- One row per ~1500-token role-tagged chunk of a (channel, chat_id) 1:1
-- conversation (groups excluded — see WP-0 join-key audit). Mirrors the
-- crm_win_embeddings / brain_chunks pgvector shape: same embedding model
-- (text-embedding-3-small, 1536-dim), same org_guc RLS (role app_ledger +
-- app.current_org_id GUC, see with-org-core.ts).
--
-- pgvector extension guard — idempotent; Supabase projects on this stack
-- already have it enabled, but new environments (or a fresh branch) need it.
create extension if not exists vector;

create table if not exists public.crm_conversation_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  channel text not null,
  chat_id text not null,
  contact_id uuid,
  party_id uuid,
  chunk_index int not null default 0,
  content text not null,
  embedding vector(1536),
  msg_count int not null default 0,
  first_at timestamptz,
  last_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create unique index if not exists crm_conversation_chunks_uniq
  on public.crm_conversation_chunks (org_id, channel, chat_id, chunk_index);

create index if not exists crm_conversation_chunks_org_chat_idx
  on public.crm_conversation_chunks (org_id, channel, chat_id);

-- ANN index for cosine search — same index family as crm_win_embeddings /
-- brain_chunks (ivfflat, vector_cosine_ops). lists=100 is a reasonable default
-- for a corpus in the tens-of-thousands of rows; revisit if the corpus grows
-- an order of magnitude.
--
-- ★ verified in local validation: ivfflat's default probes=1 badly under-
-- recalls on a small/partially-backfilled corpus (silently 0 rows for a
-- plausible query — exactly the "little data... low recall" NOTICE Postgres
-- prints when this index is created). similarConversations() in
-- crm-conversation-vectors.service.ts sets `SET LOCAL ivfflat.probes = 10`
-- before every query — do not drop that when touching this query path.
create index if not exists crm_conversation_chunks_embedding_ivfflat
  on public.crm_conversation_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.crm_conversation_chunks enable row level security;
alter table public.crm_conversation_chunks force row level security;
drop policy if exists crm_conversation_chunks_org_guc on public.crm_conversation_chunks;
create policy crm_conversation_chunks_org_guc on public.crm_conversation_chunks
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- app_ledger is the non-bypass role withOrgCore SET LOCAL ROLEs into inside the
-- txn — needs explicit table grants, same as brains/parties/crm_win_embeddings.
grant select, insert, update, delete on public.crm_conversation_chunks to app_ledger;

comment on table public.crm_conversation_chunks is
  'Semantic retrieval corpus for CRM Conversation Intelligence: role-tagged, chunked (~1500 tok), embedded (1536-dim) 1:1 conversation text. RLS via app_ledger + app.current_org_id GUC (withOrgCore).';
