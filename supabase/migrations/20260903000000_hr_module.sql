-- HR module (spec 2026-09-02-hub-team-hr-module-spec, S1) — modeled on frappe/hrms.
-- Employees bridge hub logins (profile_id, no FK: profiles is prod-only) to the
-- scheduling resource the slot engine reads. Holidays materialise weekly offs as
-- rows; leave requests carry the counted days and a pending/approved/rejected/
-- cancelled status. Org isolation via the app_ledger role + app.current_org_id GUC.

create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  profile_id uuid,
  party_id uuid,
  resource_id uuid references public.sched_resources(id) on delete set null,
  name text not null,
  email text,
  designation text,
  status text not null default 'active',
  joined_on date,
  left_on date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_employees_org_idx on public.hr_employees (org_id);
create unique index if not exists hr_employees_org_profile_uniq on public.hr_employees (org_id, profile_id) where profile_id is not null;
create unique index if not exists hr_employees_org_resource_uniq on public.hr_employees (org_id, resource_id) where resource_id is not null;

create table if not exists public.hr_holidays (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  date date not null,
  name text not null,
  weekly_off boolean not null default false
);
create unique index if not exists hr_holidays_org_date_uniq on public.hr_holidays (org_id, date);

create table if not exists public.hr_leave_types (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  code text not null,
  name text not null,
  paid boolean not null default true,
  allow_negative boolean not null default false,
  include_holiday boolean not null default false,
  max_days_per_request integer,
  active boolean not null default true
);
create unique index if not exists hr_leave_types_org_code_uniq on public.hr_leave_types (org_id, code);

create table if not exists public.hr_leave_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  days numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists hr_leave_allocations_employee_idx on public.hr_leave_allocations (employee_id);

create table if not exists public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id),
  from_date date not null,
  to_date date not null,
  half_day boolean not null default false,
  days numeric not null,
  reason text,
  status text not null default 'pending',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hr_leave_requests_employee_idx on public.hr_leave_requests (employee_id, from_date);
create index if not exists hr_leave_requests_org_status_idx on public.hr_leave_requests (org_id, status);

-- RLS: org isolation via app_ledger + GUC (same shape as 20260617150000_scheduling.sql).
grant select, insert, update, delete on public.hr_employees         to app_ledger;
grant select, insert, update, delete on public.hr_holidays          to app_ledger;
grant select, insert, update, delete on public.hr_leave_types       to app_ledger;
grant select, insert, update, delete on public.hr_leave_allocations to app_ledger;
grant select, insert, update, delete on public.hr_leave_requests    to app_ledger;

alter table public.hr_employees         enable row level security;
alter table public.hr_employees         force  row level security;
alter table public.hr_holidays          enable row level security;
alter table public.hr_holidays          force  row level security;
alter table public.hr_leave_types       enable row level security;
alter table public.hr_leave_types       force  row level security;
alter table public.hr_leave_allocations enable row level security;
alter table public.hr_leave_allocations force  row level security;
alter table public.hr_leave_requests    enable row level security;
alter table public.hr_leave_requests    force  row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'hr_employees_org_guc') then
    create policy hr_employees_org_guc on public.hr_employees
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'hr_holidays_org_guc') then
    create policy hr_holidays_org_guc on public.hr_holidays
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'hr_leave_types_org_guc') then
    create policy hr_leave_types_org_guc on public.hr_leave_types
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'hr_leave_allocations_org_guc') then
    create policy hr_leave_allocations_org_guc on public.hr_leave_allocations
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'hr_leave_requests_org_guc') then
    create policy hr_leave_requests_org_guc on public.hr_leave_requests
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
