-- Cold-path support for /crm/insights. Production applies these indexes with
-- CREATE INDEX CONCURRENTLY before this migration ships; IF NOT EXISTS makes
-- the deploy transaction a no-op there while fresh environments remain whole.

-- The rollup refresh filters exactly this inbound/non-bot population by a
-- rolling coalesced timestamp. Without the expression index Postgres scans the
-- messages heap before tokenizing each refresh range.
set local lock_timeout = '2s';
set local statement_timeout = '5s';

create index if not exists messages_crm_insights_inbound_time_idx
  on public.messages (org_id, (coalesce(occurred_at, created_at)))
  where direction = 'inbound'
    and is_bot is not true;

create index if not exists messages_crm_insights_rollup_time_idx
  on public.messages ((coalesce(occurred_at, created_at)))
  where direction = 'inbound'
    and is_bot is not true
    and content is not null
    and length(trim(content)) > 0;

do $$
begin
  if (
    select count(*)
    from pg_class index_class
    join pg_index index_meta on index_meta.indexrelid = index_class.oid
    join pg_namespace namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public'
      and index_class.relname in (
        'messages_crm_insights_inbound_time_idx',
        'messages_crm_insights_rollup_time_idx'
      )
      and index_meta.indisvalid
      and index_meta.indisready
  ) <> 2 then
    raise exception 'CRM Insights indexes must be precreated concurrently and valid';
  end if;
end $$;

set local statement_timeout = default;
set local lock_timeout = default;

-- Theme rollups are org + last_at bounded for 30d/90d/365d views.
create index if not exists crm_conversation_analysis_org_last_idx
  on public.crm_conversation_analysis (org_id, last_at desc);

-- The empty-state counter only needs pending rows.
create index if not exists crm_conversation_index_pending_idx
  on public.crm_conversation_index (org_id)
  where analyzed_at is null;

-- Current sentiment is a trailing-30d aggregate; INCLUDE keeps score on the
-- index leaf so the planner can avoid sentiment heap reads after visibility.
do $$
begin
  if to_regclass('public.crm_message_sentiment') is not null then
    execute 'create index if not exists crm_message_sentiment_org_analyzed_idx
      on public.crm_message_sentiment (org_id, analyzed_at desc) include (score)';
  end if;
end $$;

-- Daily document-frequency rollup. tsvector_to_array returns each message's
-- unique lexemes, so count(*) preserves the word cloud's document-frequency
-- semantics without re-tokenizing every historic message on every cold request.
create table if not exists public.crm_word_frequency_daily (
  org_id text not null,
  day date not null,
  word text not null,
  document_count bigint not null check (document_count >= 0),
  refreshed_at timestamptz not null default now(),
  primary key (org_id, day, word)
);

alter table public.crm_word_frequency_daily enable row level security;
alter table public.crm_word_frequency_daily force row level security;
drop policy if exists crm_word_frequency_daily_org_guc on public.crm_word_frequency_daily;
create policy crm_word_frequency_daily_org_guc on public.crm_word_frequency_daily
  for select
  using (org_id = current_setting('app.current_org_id', true));
grant select on public.crm_word_frequency_daily to app_ledger;

create or replace function public.crm_refresh_word_frequency_daily(p_from date, p_to date)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  refreshed bigint := 0;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid CRM word-frequency refresh range';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-word-frequency-daily'));

  delete from public.crm_word_frequency_daily
  where day between p_from and p_to;

  insert into public.crm_word_frequency_daily
    (org_id, day, word, document_count, refreshed_at)
  select m.org_id,
         (coalesce(m.occurred_at, m.created_at) at time zone 'UTC')::date as day,
         lexeme.word,
         count(*)::bigint,
         now()
  from public.messages m
  cross join lateral unnest(
    tsvector_to_array(to_tsvector('simple', coalesce(m.content, '')))
  ) as lexeme(word)
  where m.direction = 'inbound'
    and m.is_bot is not true
    and m.content is not null
    and length(trim(m.content)) > 0
    and char_length(lexeme.word) >= 3
    and coalesce(m.occurred_at, m.created_at) >= (p_from::timestamp at time zone 'UTC')
    and coalesce(m.occurred_at, m.created_at) <
      ((p_to + 1)::timestamp at time zone 'UTC')
  group by m.org_id, 2, lexeme.word;

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;

revoke all on function public.crm_refresh_word_frequency_daily(date, date) from public;

-- Historical population is intentionally NOT part of this transactional
-- migration. The nightly `/refresh/full` cron performs the bounded 4,000-day repair;
-- production is pre-warmed and verified before this migration is released.

-- One row per chat-day preserves the existing two-stage sentiment semantics:
-- message scores average within a chat-day, then chat-days average into the
-- selected day/week/month bucket so chatty customers do not dominate.
create table if not exists public.crm_sentiment_chat_daily (
  org_id text not null,
  chat_id text not null,
  day date not null,
  score double precision not null,
  message_count integer not null check (message_count >= 0),
  refreshed_at timestamptz not null default now(),
  primary key (org_id, chat_id, day)
);

create index if not exists crm_sentiment_chat_daily_org_day_idx
  on public.crm_sentiment_chat_daily (org_id, day)
  include (score, message_count);

alter table public.crm_sentiment_chat_daily enable row level security;
alter table public.crm_sentiment_chat_daily force row level security;
drop policy if exists crm_sentiment_chat_daily_org_guc on public.crm_sentiment_chat_daily;
create policy crm_sentiment_chat_daily_org_guc on public.crm_sentiment_chat_daily
  for select
  using (org_id = current_setting('app.current_org_id', true));
grant select on public.crm_sentiment_chat_daily to app_ledger;

create or replace function public.crm_refresh_sentiment_chat_daily(
  p_org_id text,
  p_from date,
  p_to date
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  refreshed bigint := 0;
begin
  if p_org_id is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid CRM sentiment refresh range';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-sentiment-chat-daily'));

  delete from public.crm_sentiment_chat_daily
  where day between p_from and p_to
    and org_id = p_org_id;

  insert into public.crm_sentiment_chat_daily
    (org_id, chat_id, day, score, message_count, refreshed_at)
  select s.org_id,
         m.chat_id,
         (coalesce(m.occurred_at, m.created_at) at time zone 'UTC')::date as day,
         avg(s.score)::float8,
         count(*)::int,
         now()
  from public.crm_message_sentiment s
  join public.messages m on m.id = s.message_id and m.org_id = s.org_id
  where s.org_id = p_org_id
    and m.direction = 'inbound'
    and m.is_bot is not true
    and coalesce(m.occurred_at, m.created_at) >= (p_from::timestamp at time zone 'UTC')
    and coalesce(m.occurred_at, m.created_at) <
      ((p_to + 1)::timestamp at time zone 'UTC')
  group by s.org_id, m.chat_id, 3;

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;

revoke all on function public.crm_refresh_sentiment_chat_daily(text, date, date) from public;

-- As above, the bearer-authenticated nightly cron owns bounded historical
-- population. Keeping it out of the migration prevents a deploy transaction
-- from rescanning years of message history.
