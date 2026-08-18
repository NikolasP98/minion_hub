-- Latest provisioning run per organization, so the admin org-management page
-- can show onboarding health across refreshes and sessions. One row per org
-- (upsert on org_id); read/written exclusively via the service role from
-- admin-gated endpoints, so RLS is enabled with NO policies (deny-all for
-- every non-bypass role).
create table if not exists public.org_provision_runs (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  ok boolean not null,
  steps jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.org_provision_runs enable row level security;
alter table public.org_provision_runs force row level security;
