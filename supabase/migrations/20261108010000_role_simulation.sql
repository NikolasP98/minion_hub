-- Session state is server-owned; no browser/PostgREST role can write a role claim.
create table if not exists public.app_role_simulations (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Retain an invalid context after organization deletion until authenticated Finish.
  org_id uuid not null,
  role_key text,
  generation uuid not null,
  return_to text,
  started_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint role_simulation_role_bounded check (role_key is null or length(role_key) between 1 and 256),
  constraint role_simulation_return_bounded check (return_to is null or length(return_to)<=4096)
);
--> statement-breakpoint
alter table public.app_role_simulations drop constraint if exists app_role_simulations_org_id_fkey;
--> statement-breakpoint
alter table public.app_role_simulations enable row level security;
--> statement-breakpoint
alter table public.app_role_simulations force row level security;
--> statement-breakpoint
revoke all on public.app_role_simulations from PUBLIC, anon, authenticated, service_role, app_ledger;
--> statement-breakpoint
-- Metadata defaults also cover existing direct audit inserts inside withOrgCore.
alter table public.doc_audit_log
  add column if not exists simulation_role_key text default nullif(current_setting('app.simulation_role_key',true),''),
  add column if not exists simulation_generation uuid default nullif(current_setting('app.simulation_generation',true),'')::uuid;
--> statement-breakpoint
-- Legacy domain writers sometimes pass a null/system actor or insert directly.
-- Matching request GUCs make the actual person attribution mandatory in mode.
create or replace function public.app_attribute_simulation_audit() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare
  simulation_role text := nullif(current_setting('app.simulation_role_key',true),'');
  simulation_generation uuid := nullif(current_setting('app.simulation_generation',true),'')::uuid;
  simulation_actor jsonb := nullif(current_setting('app.simulation_actor',true),'')::jsonb;
begin
  if simulation_role is null or simulation_generation is null then return new; end if;
  if nullif(simulation_actor->>'id','') is null then
    raise exception 'Simulation audit requires the actual actor';
  end if;
  new.actor_id := (simulation_actor->>'id')::uuid;
  new.actor_name := coalesce(simulation_actor->>'name',new.actor_name);
  new.simulation_role_key := simulation_role;
  new.simulation_generation := simulation_generation;
  return new;
end $$;
--> statement-breakpoint
drop trigger if exists doc_audit_simulation_actor on public.doc_audit_log;
--> statement-breakpoint
create trigger doc_audit_simulation_actor before insert on public.doc_audit_log
  for each row execute function public.app_attribute_simulation_audit();
