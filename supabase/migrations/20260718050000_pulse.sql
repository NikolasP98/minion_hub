-- <ts>_pulse.sql
create table if not exists public.pulse_proposals (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  created_at   timestamptz not null default now(),
  source       text not null,                      -- daily_briefing|email|whatsapp|calendar
  kind         text not null,                      -- digest|create_event|reminder|draft_reply|fyi
  title        text not null,
  summary      text,
  payload      jsonb not null default '{}',        -- { tool, args } for executable kinds
  status       text not null default 'pending',    -- pending|approved|dismissed|executed|failed|snoozed
  dedup_key    text not null,
  decided_by   text,
  executed_at  timestamptz,
  error        text,
  unique (org_id, dedup_key)
);
create index if not exists pulse_proposals_org_status_idx
  on public.pulse_proposals (org_id, status, created_at desc);

alter table public.pulse_proposals enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pulse_proposals' and policyname='pulse_proposals_org') then
    create policy pulse_proposals_org on public.pulse_proposals
      using (org_id = current_setting('app.current_org_id', true))
      with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
grant select, insert, update, delete on public.pulse_proposals to app_ledger;

create table if not exists public.pulse_settings (
  org_id        text primary key,
  enabled       boolean not null default false,
  briefing_time text not null default '08:00',
  locale        text not null default 'es',
  channels      text[] not null default '{whatsapp}',
  watch         jsonb not null default '{"email":true,"whatsapp":true,"calendar":true}',
  auto_approve  jsonb not null default '{}',
  updated_at    timestamptz not null default now()
);
alter table public.pulse_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pulse_settings' and policyname='pulse_settings_org') then
    create policy pulse_settings_org on public.pulse_settings
      using (org_id = current_setting('app.current_org_id', true))
      with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
grant select, insert, update, delete on public.pulse_settings to app_ledger;
