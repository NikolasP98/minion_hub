-- Spec 043 (hub org entitlements), S1. Schema only, no data: a missing org_plans
-- row means Base, so no backfill is needed to ship this.

create table if not exists public.org_plans (
  org_id             uuid primary key references public.organizations(id) on delete cascade,
  plan_key           text not null,  -- no CHECK: adding a plan needs no migration
  set_by_profile_id  uuid,
  set_note           text,
  set_at             timestamptz not null default now()
);

-- Append-only audit. No FK on org_id so the trail outlives a deleted org.
create table if not exists public.org_plan_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  from_plan         text,
  to_plan           text not null,
  actor_profile_id  uuid,
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists org_plan_events_org_created_idx
  on public.org_plan_events (org_id, created_at desc);

alter table public.org_plans enable row level security;
alter table public.org_plans force row level security;
alter table public.org_plan_events enable row level security;
alter table public.org_plan_events force row level security;

-- Supabase default privileges grant ALL on new public tables to anon/authenticated.
revoke all on public.org_plans from public, anon, authenticated;
revoke all on public.org_plan_events from public, anon, authenticated;

-- Members read only their own org's plan; nobody but the owner connection writes.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'org_plans' and policyname = 'org_plans_org_guc') then
    create policy org_plans_org_guc on public.org_plans
      for select using (org_id::text = current_setting('app.current_org_id', true));
  end if;
end $$;
grant select on public.org_plans to app_ledger;
-- org_plan_events: no policy and no grant (service connection only).
