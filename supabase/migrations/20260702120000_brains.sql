-- P4 AI-Brains — org-scoped knowledge bases (brains), documents, chunks, access.
--
-- Mirrors the parties/agent_memories org_guc RLS shape: role app_ledger +
-- app.current_org_id GUC (see with-org-core.ts). Vector index type matches
-- agent_memories.embedding_hnsw (hnsw / vector_cosine_ops) — same embedding
-- model (text-embedding-3-small, 1536-dim), same ANN index choice.

create table if not exists public.brains (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text not null,
  description text,
  icon text,
  visibility text not null default 'org',        -- org | private
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_documents (
  id uuid primary key default gen_random_uuid(),
  brain_id uuid not null references public.brains (id) on delete cascade,
  org_id text not null,
  title text not null,
  source_type text not null,                     -- note | url | upload | module_ref
  source_ref text,                               -- url, file id, or module key (e.g. 'fin_products')
  content_md text,
  status text not null default 'pending',        -- pending | ingesting | ready | failed
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_chunks (
  id uuid primary key default gen_random_uuid(),
  brain_id uuid not null references public.brains (id) on delete cascade,
  document_id uuid not null references public.brain_documents (id) on delete cascade,
  org_id text not null,
  seq int not null,
  chunk_text text not null,
  embedding vector(1536),
  meta jsonb
);

create table if not exists public.brain_access (
  brain_id uuid not null references public.brains (id) on delete cascade,
  org_id text not null,
  principal_type text not null,                  -- role | user | agent
  principal_id text not null,
  level text not null default 'read',            -- read | write
  primary key (brain_id, principal_type, principal_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────

create index if not exists brains_org_idx on public.brains (org_id);
create index if not exists brain_documents_org_brain_idx on public.brain_documents (org_id, brain_id);
create index if not exists brain_chunks_org_brain_idx on public.brain_chunks (org_id, brain_id);
create index if not exists brain_chunks_document_idx on public.brain_chunks (document_id);
create index if not exists brain_access_org_brain_idx on public.brain_access (org_id, brain_id);

-- ANN index for cosine search — same type as agent_memories_embedding_hnsw.
create index if not exists brain_chunks_embedding_hnsw
  on public.brain_chunks using hnsw (embedding vector_cosine_ops);

-- ── RLS (org_guc — role app_ledger + app.current_org_id GUC) ────────────────
-- Matches parties_org_guc / agent_memories_org_isolation exactly: single
-- ALL-command policy per table, org_id compared to the session GUC.

alter table public.brains enable row level security;
alter table public.brains force row level security;
drop policy if exists brains_org_guc on public.brains;
create policy brains_org_guc on public.brains
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table public.brain_documents enable row level security;
alter table public.brain_documents force row level security;
drop policy if exists brain_documents_org_guc on public.brain_documents;
create policy brain_documents_org_guc on public.brain_documents
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table public.brain_chunks enable row level security;
alter table public.brain_chunks force row level security;
drop policy if exists brain_chunks_org_guc on public.brain_chunks;
create policy brain_chunks_org_guc on public.brain_chunks
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table public.brain_access enable row level security;
alter table public.brain_access force row level security;
drop policy if exists brain_access_org_guc on public.brain_access;
create policy brain_access_org_guc on public.brain_access
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- app_ledger is the non-bypass role withOrgCore SET LOCAL ROLEs into inside the
-- txn (see with-org-core.ts) — needs explicit table grants, same as `parties`.
grant select, insert, update, delete on public.brains to app_ledger;
grant select, insert, update, delete on public.brain_documents to app_ledger;
grant select, insert, update, delete on public.brain_chunks to app_ledger;
grant select, insert, update, delete on public.brain_access to app_ledger;

comment on table public.brains is
  'Org-scoped knowledge base (P4 AI-Brains). RLS via app_ledger + app.current_org_id GUC (withOrgCore).';
comment on table public.brain_documents is
  'Source documents (note/url/upload/module_ref) ingested into a brain. status tracks the bg-runtime brain_ingest job.';
comment on table public.brain_chunks is
  'Chunked + embedded (1536-dim, text-embedding-3-small) document text — the vector search corpus for one brain.';
comment on table public.brain_access is
  'Per-brain access grants (role/user/agent principal, read/write level) for visibility=private brains.';
