-- CRM Conversation Intelligence (WP-A) — incremental/idempotent vectorization
-- signature store (spec §6). One row per (org_id, channel, chat_id) recording
-- what the vectorize/analyze ticks last saw, so re-running is a no-op when
-- nothing changed and correct under late-arriving/bulk-imported messages
-- (the IG-import case: old occurred_at, fresh created_at).
--
-- content_sig = md5 of concatenated eligible message ids+content — the
-- authoritative "did anything actually change" check. last_ingested_at
-- (MAX(created_at) of eligible rows) is the cheap candidate-scan filter that
-- catches new/imported inserts regardless of their event-time.

create table if not exists public.crm_conversation_index (
  org_id text not null,
  channel text not null,
  chat_id text not null,
  contact_id uuid,
  party_id uuid,
  eligible_count int not null default 0,
  last_occurred_at timestamptz,
  last_ingested_at timestamptz,
  content_sig text,
  chunk_count int not null default 0,
  vectorized_at timestamptz,
  analyzed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (org_id, channel, chat_id)
);

-- Candidate-scan fast filter: "conversations touched since I last looked".
create index if not exists crm_conversation_index_ingested_idx
  on public.crm_conversation_index (org_id, last_ingested_at);

alter table public.crm_conversation_index enable row level security;
alter table public.crm_conversation_index force row level security;
drop policy if exists crm_conversation_index_org_guc on public.crm_conversation_index;
create policy crm_conversation_index_org_guc on public.crm_conversation_index
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

grant select, insert, update, delete on public.crm_conversation_index to app_ledger;

comment on table public.crm_conversation_index is
  'Signature store for incremental/idempotent CRM conversation vectorize+analyze ticks (spec §6). RLS via app_ledger + app.current_org_id GUC (withOrgCore).';
