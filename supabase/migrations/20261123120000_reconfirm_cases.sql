-- Spec 139 (reminder negation follow-up), S1. A client's "no" to a reminder opens a
-- reconfirmation case instead of cancelling the appointment; every classified reply is
-- logged (the log is also the scan's cursor). Additive and idempotent: runs in the
-- production build. "Por reconfirmar" is derived from an open case, not a booking status.

-- 1. One row per case.
create table if not exists public.sched_reconfirm_cases (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   text not null,
  booking_id               uuid not null references public.sched_bookings(id) on delete restrict,
  subject_key              text not null,           -- the visit's groupId, else the booking id
  contact_id               uuid,
  channel                  text not null,
  account_id               text,                    -- account the reminder used; null = gateway default
  recipient                text not null,
  booking_start_at         timestamptz not null,    -- a different start later = someone moved it
  agent_state              text not null default 'none'
    check (agent_state in ('none','asking','offered','done')),
  result                   text
    check (result is null or result in ('rescheduled','will_come','declined','wants_other_date','no_answer','unclear','late_reply','send_failed','staff_handling')),
  summary                  text,
  offered_slots            jsonb not null default '[]'::jsonb,
  offer_booking_updated_at timestamptz,
  wait_until               timestamptz,
  last_inbound_at          timestamptz,
  opened_at                timestamptz not null default now(),
  closed_at                timestamptz,
  closed_by                uuid,
  close_action             text
    check (close_action is null or close_action in ('attended','agent','booking_closed','moved_by_staff')),
  close_note               text check (close_note is null or length(close_note) <= 500),
  check ((closed_at is null) = (close_action is null))
);
-- One open case per appointment (per visit for a merged visit).
create unique index if not exists sched_reconfirm_cases_open_uniq
  on public.sched_reconfirm_cases (org_id, subject_key) where closed_at is null;
create index if not exists sched_reconfirm_cases_booking_idx
  on public.sched_reconfirm_cases (org_id, booking_id);

-- 2. Append-only log of verdicts, agent messages and staff actions.
create table if not exists public.sched_reconfirm_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  booking_id  uuid not null references public.sched_bookings(id) on delete restrict,
  case_id     uuid references public.sched_reconfirm_cases(id) on delete restrict,
  kind        text not null
    check (kind in ('verdict','agent_message','client_message','staff_action','system')),
  verdict     text,
  confidence  numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  via         text check (via is null or via in ('keyword','jev')),
  content     text,
  send_status text check (send_status is null or send_status in ('sending','sent','failed')),
  step        text,
  message_id  text,
  inbound_at  timestamptz,                  -- newest client message this row covers (the cursor)
  inbound_message_id uuid,                  -- that message's id: with inbound_at it orders equal timestamps
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists sched_reconfirm_events_booking_idx
  on public.sched_reconfirm_events (org_id, booking_id, created_at);
alter table public.sched_reconfirm_events add column if not exists inbound_message_id uuid;
create index if not exists sched_reconfirm_events_case_idx
  on public.sched_reconfirm_events (org_id, case_id, created_at);
-- One agent message per step per case: two overlapping ticks cannot send twice.
create unique index if not exists sched_reconfirm_events_case_step_uniq
  on public.sched_reconfirm_events (case_id, step) where kind = 'agent_message';

-- 3. How long the agent waits for an answer (used from S2). Inline check: skipped with the column.
alter table public.sched_reminder_config
  add column if not exists negation_wait_hours integer not null default 24
    check (negation_wait_hours between 1 and 168);

-- 4. The account a reminder was sent with, so the reply scan reads that account's inbox.
-- Null = legacy row or the gateway default (the scan falls back to the config's account).
alter table public.sched_reminders add column if not exists account_id text;

-- RLS: enable + force + <table>_org_guc policy + grant to app_ledger
-- (convention: 20261025100000_crm_doors.sql).
do $$
declare t text;
begin
  foreach t in array array['sched_reconfirm_cases','sched_reconfirm_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_org_guc') then
      execute format(
        'create policy %I on public.%I using (org_id = current_setting(''app.current_org_id'', true)) with check (org_id = current_setting(''app.current_org_id'', true))',
        t || '_org_guc', t);
    end if;
    -- The events log is append-only: no UPDATE/DELETE grant (see the triggers below).
    execute format('grant select, insert%s on public.%I to app_ledger',
      case when t = 'sched_reconfirm_cases' then ', update, delete' else '' end, t);
  end loop;
end $$;

-- Append-only events: revoke the write paths and raise on any UPDATE, DELETE or TRUNCATE.
-- The booking and case foreign keys are `on delete restrict`, so no cascade ever reaches this
-- trigger: a booking that has a case cannot be deleted (the app never deletes bookings).
revoke update, delete, truncate on public.sched_reconfirm_events from public, anon, authenticated, service_role, app_ledger;
create or replace function public.sched_reconfirm_events_append_only() returns trigger
  language plpgsql as $$
begin
  raise exception 'sched_reconfirm_events is append-only' using errcode = '23514';
end $$;
drop trigger if exists sched_reconfirm_events_no_change on public.sched_reconfirm_events;
create trigger sched_reconfirm_events_no_change before update or delete on public.sched_reconfirm_events
  for each row execute function public.sched_reconfirm_events_append_only();
drop trigger if exists sched_reconfirm_events_no_truncate on public.sched_reconfirm_events;
create trigger sched_reconfirm_events_no_truncate before truncate on public.sched_reconfirm_events
  for each statement execute function public.sched_reconfirm_events_append_only();
