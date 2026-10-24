-- Per-organization custom navigation (meta spec 037): sections with alias pages
-- and role grants. One jsonb document per org (src/lib/nav/custom-sections.ts),
-- mirrors app_table_config.

create table if not exists public.app_nav_config (
  org_id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors crm_settings) ──
grant select, insert, update, delete on public.app_nav_config to app_ledger;
--> statement-breakpoint
alter table public.app_nav_config enable row level security;
--> statement-breakpoint
alter table public.app_nav_config force row level security;
--> statement-breakpoint
drop policy if exists app_nav_config_org_guc on public.app_nav_config;
--> statement-breakpoint
create policy app_nav_config_org_guc on public.app_nav_config
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
