-- CRM Conversation Intelligence (WP-A) — per-conversation structured rollup.
--
-- One row per (channel, chat_id) 1:1 conversation: a cheap-LLM structured
-- extraction (intent, pain points, over-explaining verdict) that answers
-- CENSUS questions ("what fraction of conversations are us over-explaining")
-- that semantic retrieval (crm_conversation_chunks) cannot. Same org_guc RLS
-- shape as every other org-scoped core table on this stack.

create table if not exists public.crm_conversation_analysis (
  org_id text not null,
  channel text not null,
  chat_id text not null,
  contact_id uuid,
  primary_intent text,
  pain_points jsonb not null default '[]',
  asked_for text,
  answered_summary text,
  over_answered boolean,
  over_answered_reason text,
  msg_count int not null default 0,
  first_at timestamptz,
  last_at timestamptz,
  analyzed_at timestamptz not null default now(),
  model text,
  metadata jsonb not null default '{}',
  primary key (org_id, channel, chat_id)
);

create index if not exists crm_conversation_analysis_over_answered_idx
  on public.crm_conversation_analysis (org_id, over_answered);

alter table public.crm_conversation_analysis enable row level security;
alter table public.crm_conversation_analysis force row level security;
drop policy if exists crm_conversation_analysis_org_guc on public.crm_conversation_analysis;
create policy crm_conversation_analysis_org_guc on public.crm_conversation_analysis
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

grant select, insert, update, delete on public.crm_conversation_analysis to app_ledger;

comment on table public.crm_conversation_analysis is
  'Per-conversation structured LLM extraction (intent, pain_points, over_answered) for CRM Conversation Intelligence census questions. RLS via app_ledger + app.current_org_id GUC (withOrgCore).';
