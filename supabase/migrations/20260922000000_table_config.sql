-- Per-organization table configuration (owner directive 2026-09-21): every
-- user-facing table gets an ID column with a configurable prefix (display-only,
-- laid over the entity's human code — never the UUID) and per-field overrides
-- (label, default visibility, editing switched OFF). One jsonb document per
-- org, keyed by table id (see src/lib/tables/registry.ts), mirrors crm_settings.
--
--   { "stock.items": { "idPrefix": "ITM-",
--                      "fields": { "name": { "label": "Producto", "hidden": false, "editable": false } } } }

create table if not exists public.app_table_config (
  org_id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors crm_settings) ──
grant select, insert, update, delete on public.app_table_config to app_ledger;
--> statement-breakpoint
alter table public.app_table_config enable row level security;
--> statement-breakpoint
alter table public.app_table_config force row level security;
--> statement-breakpoint
drop policy if exists app_table_config_org_guc on public.app_table_config;
--> statement-breakpoint
create policy app_table_config_org_guc on public.app_table_config
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
