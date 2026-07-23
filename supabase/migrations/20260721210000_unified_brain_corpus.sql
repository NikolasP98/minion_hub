-- Unified Brains knowledge corpus.
--
-- Ingest once into org-scoped sources/documents/chunks, then compose those
-- sources into many focused brains. Master Brain membership is implicit.

create extension if not exists vector;

alter table public.brains
  add column if not exists kind text not null default 'focused',
  add column if not exists include_all_sources boolean not null default false;

update public.brains
set kind = case when kind = 'master' then 'master' else 'focused' end,
    include_all_sources = (kind = 'master');

alter table public.brains drop constraint if exists brains_kind_check;
alter table public.brains add constraint brains_kind_check
  check (kind in ('master', 'focused'));

alter table public.brains drop constraint if exists brains_master_scope_check;
alter table public.brains add constraint brains_master_scope_check
  check ((kind = 'master') = include_all_sources);

create unique index if not exists brains_org_master_uniq
  on public.brains (org_id) where kind = 'master';
create unique index if not exists brains_org_id_uniq
  on public.brains (org_id, id);

-- Seed the invariant for every currently registered organization. The runtime
-- ensure helper handles new organizations and repairs partially provisioned
-- environments idempotently.
insert into public.brains
  (org_id, name, description, icon, visibility, kind, include_all_sources)
select o.id::text, 'Master Brain',
  'Organization-wide knowledge from every enabled source.',
  'brain', 'org', 'master', true
from public.organizations o
on conflict (org_id) where kind = 'master' do nothing;

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connector text not null,
  external_key text not null,
  name text not null,
  config jsonb not null default '{}',
  status text not null default 'discovered',
  sync_mode text not null default 'incremental',
  cadence text,
  watermark jsonb not null default '{}',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_sources_status_check
    check (status in ('discovered', 'queued', 'processing', 'ready', 'degraded', 'failed')),
  constraint knowledge_sources_org_connector_key_uniq unique (org_id, connector, external_key),
  constraint knowledge_sources_org_id_uniq unique (org_id, id)
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_id uuid not null,
  external_id text not null,
  title text not null,
  raw_text text not null,
  normalized_text text not null,
  content_hash text not null,
  source_revision text,
  occurred_at timestamptz,
  source_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  status text not null default 'pending',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_status_check
    check (status in ('pending', 'processing', 'ready', 'failed', 'deleted')),
  constraint knowledge_documents_org_source_external_uniq unique (org_id, source_id, external_id),
  constraint knowledge_documents_org_id_uniq unique (org_id, id),
  constraint knowledge_documents_source_fk
    foreign key (org_id, source_id)
    references public.knowledge_sources (org_id, id) on delete cascade
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_id uuid not null,
  document_id uuid not null,
  chunk_key text not null,
  kind text not null default 'raw',
  seq int not null,
  chunk_text text not null,
  context_prefix text,
  content_hash text not null,
  embedding vector(1536),
  embedding_model text,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(context_prefix, '') || ' ' || chunk_text)
  ) stored,
  occurred_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_chunks_kind_check
    check (kind in ('summary', 'section', 'burst', 'code_file', 'code_symbol', 'raw')),
  constraint knowledge_chunks_org_document_key_uniq unique (org_id, document_id, chunk_key),
  constraint knowledge_chunks_source_fk
    foreign key (org_id, source_id)
    references public.knowledge_sources (org_id, id) on delete cascade,
  constraint knowledge_chunks_document_fk
    foreign key (org_id, document_id)
    references public.knowledge_documents (org_id, id) on delete cascade
);

create table if not exists public.brain_sources (
  brain_id uuid not null,
  org_id text not null,
  source_id uuid not null,
  weight real not null default 1,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (brain_id, source_id),
  constraint brain_sources_weight_check check (weight > 0),
  constraint brain_sources_brain_fk
    foreign key (org_id, brain_id)
    references public.brains (org_id, id) on delete cascade,
  constraint brain_sources_source_fk
    foreign key (org_id, source_id)
    references public.knowledge_sources (org_id, id) on delete cascade
);

create index if not exists knowledge_sources_org_status_idx
  on public.knowledge_sources (org_id, status);
create index if not exists knowledge_documents_org_source_status_idx
  on public.knowledge_documents (org_id, source_id, status);
create index if not exists knowledge_documents_org_source_updated_idx
  on public.knowledge_documents (org_id, source_id, source_updated_at desc);
create index if not exists knowledge_chunks_org_source_document_idx
  on public.knowledge_chunks (org_id, source_id, document_id);
create index if not exists knowledge_chunks_org_source_occurred_idx
  on public.knowledge_chunks (org_id, source_id, occurred_at desc);
create index if not exists knowledge_chunks_search_gin
  on public.knowledge_chunks using gin (search_vector);
create index if not exists knowledge_chunks_embedding_hnsw
  on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists brain_sources_org_brain_idx
  on public.brain_sources (org_id, brain_id);
create index if not exists brain_sources_org_source_idx
  on public.brain_sources (org_id, source_id);

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_sources force row level security;
drop policy if exists knowledge_sources_org_guc on public.knowledge_sources;
create policy knowledge_sources_org_guc on public.knowledge_sources for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_documents force row level security;
drop policy if exists knowledge_documents_org_guc on public.knowledge_documents;
create policy knowledge_documents_org_guc on public.knowledge_documents for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_chunks force row level security;
drop policy if exists knowledge_chunks_org_guc on public.knowledge_chunks;
create policy knowledge_chunks_org_guc on public.knowledge_chunks for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table public.brain_sources enable row level security;
alter table public.brain_sources force row level security;
drop policy if exists brain_sources_org_guc on public.brain_sources;
create policy brain_sources_org_guc on public.brain_sources for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

grant select, insert, update, delete on public.knowledge_sources to app_ledger;
grant select, insert, update, delete on public.knowledge_documents to app_ledger;
grant select, insert, update, delete on public.knowledge_chunks to app_ledger;
grant select, insert, update, delete on public.brain_sources to app_ledger;

comment on table public.knowledge_sources is
  'Org-scoped upstream connector feeds shared by Master and Focused brains.';
comment on table public.knowledge_documents is
  'Normalized, idempotent source documents stored once in the canonical brain corpus.';
comment on table public.knowledge_chunks is
  'Changed-chunk-only lexical and vector evidence shared across brain scopes.';
comment on table public.brain_sources is
  'Focused-brain source membership; Master Brain membership is implicit.';
