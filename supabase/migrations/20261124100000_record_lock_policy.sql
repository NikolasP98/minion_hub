-- Spec 140 S1: per-organization record lock policy (data-model.md). Additive and idempotent.
-- No policy row = the default (month close only), so no backfill. Every table carries org_id and
-- the same forced RLS as org_api_keys. No application code reads the external-lock or event tables
-- yet in S1 except the policy row; the tables ship now so later slices need no schema step.

create table if not exists public.org_lock_policy (
  org_id          text primary key,
  month_enabled   boolean not null default true,
  days_enabled    boolean not null default false,
  days            integer check (days between 1 and 3650),
  sunat_enabled   boolean not null default false,
  webhook_enabled boolean not null default false,
  updated_by      uuid,                       -- plain uuid: outlives the person
  updated_at      timestamptz not null default now(),
  constraint org_lock_policy_days_chk check (not days_enabled or days is not null)
);

create table if not exists public.org_record_locks (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  source         text not null default 'webhook' check (source in ('webhook')),
  label          text not null check (char_length(btrim(label)) between 1 and 60),
  record_type    text check (record_type in ('stock_receipt')),
  up_to          date,                        -- inclusive, org finance timezone
  record_id      uuid,
  api_key_id     uuid,                        -- no FK: keys are never deleted
  actor_name     text,
  created_at     timestamptz not null default now(),
  lifted_at      timestamptz,                 -- null = active
  lifted_by_kind text check (lifted_by_kind in ('person', 'api_key')),
  lifted_by      uuid,
  lift_reason    text,
  constraint org_record_locks_target_chk check (
    (up_to is not null) <> (record_id is not null)
    and (record_id is null or record_type is not null)
  )
);
create unique index if not exists org_record_locks_active_upto_uniq
  on public.org_record_locks (org_id, coalesce(record_type, ''), label, up_to)
  where up_to is not null and lifted_at is null;
create unique index if not exists org_record_locks_active_record_uniq
  on public.org_record_locks (org_id, record_type, record_id)
  where record_id is not null and lifted_at is null;
create index if not exists org_record_locks_active_idx
  on public.org_record_locks (org_id) where lifted_at is null;

create table if not exists public.org_lock_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  action       text not null
    check (action in ('lock', 'lift', 'unlock', 'unlock_used', 'refused', 'policy_changed')),
  record_type  text,
  record_id    uuid,
  rules        jsonb not null default '[]',
  actor_kind   text not null check (actor_kind in ('person', 'api_key', 'system')),
  actor_id     uuid,
  actor_name   text,
  reason       text check (char_length(reason) <= 1000),
  detail       jsonb not null default '{}',
  ref_event_id uuid,
  expires_at   timestamptz,
  occurred_at  timestamptz not null default now(),
  constraint org_lock_events_unlock_chk check (
    action <> 'unlock' or (record_id is not null and reason is not null and expires_at is not null)
  )
);
-- An unlock is consumed at most once, enforced by the database.
create unique index if not exists org_lock_events_used_uniq
  on public.org_lock_events (org_id, ref_event_id) where action = 'unlock_used';
create index if not exists org_lock_events_org_time_idx
  on public.org_lock_events (org_id, occurred_at desc);
create index if not exists org_lock_events_record_idx
  on public.org_lock_events (org_id, record_type, record_id, occurred_at desc);

-- The chain walk (record-locks.service) joins on the replacement entry.
create index if not exists stk_corrections_org_replacement_idx
  on public.stk_corrections (org_id, replacement_entry_id);

do $$
declare
  t text;
begin
  foreach t in array array['org_lock_policy', 'org_record_locks', 'org_lock_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- Policy and locks: one tenant-scoped policy for all commands (rows are updated in place).
-- Events: separate SELECT and INSERT policies, so there is no UPDATE or DELETE policy at all.
drop policy if exists org_lock_policy_org_guc on public.org_lock_policy;
create policy org_lock_policy_org_guc on public.org_lock_policy
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
drop policy if exists org_record_locks_org_guc on public.org_record_locks;
create policy org_record_locks_org_guc on public.org_record_locks
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
drop policy if exists org_lock_events_org_guc on public.org_lock_events;
drop policy if exists org_lock_events_org_select on public.org_lock_events;
create policy org_lock_events_org_select on public.org_lock_events for select
  using (org_id = current_setting('app.current_org_id', true));
drop policy if exists org_lock_events_org_insert on public.org_lock_events;
create policy org_lock_events_org_insert on public.org_lock_events for insert
  with check (org_id = current_setting('app.current_org_id', true));

grant select, insert, update on public.org_lock_policy to app_ledger;
grant select, insert, update on public.org_record_locks to app_ledger;
grant select, insert on public.org_lock_events to app_ledger;  -- append-only: no update, no delete

-- Triggers are the only guard against the BYPASSRLS `postgres` login (grants and RLS do not bind it).
create or replace function public.org_lock_events_append_only() returns trigger
  language plpgsql as $$
begin
  raise exception 'org_lock_events is append-only (% refused)', tg_op using errcode = '42501';
end $$;
drop trigger if exists org_lock_events_no_update_delete on public.org_lock_events;
create trigger org_lock_events_no_update_delete before update or delete on public.org_lock_events
  for each row execute function public.org_lock_events_append_only();
drop trigger if exists org_lock_events_no_truncate on public.org_lock_events;
create trigger org_lock_events_no_truncate before truncate on public.org_lock_events
  for each statement execute function public.org_lock_events_append_only();

-- Locks are lifted by a column update (lifted_*), never deleted.
create or replace function public.org_record_locks_no_delete() returns trigger
  language plpgsql as $$
begin
  raise exception 'org_record_locks rows are lifted, never deleted' using errcode = '42501';
end $$;
drop trigger if exists org_record_locks_no_delete on public.org_record_locks;
create trigger org_record_locks_no_delete before delete on public.org_record_locks
  for each row execute function public.org_record_locks_no_delete();
drop trigger if exists org_record_locks_no_truncate on public.org_record_locks;
create trigger org_record_locks_no_truncate before truncate on public.org_record_locks
  for each statement execute function public.org_record_locks_no_delete();
