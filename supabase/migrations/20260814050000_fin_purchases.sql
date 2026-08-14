-- Purchases module: SUNAT RCE backfill + minion-local CRUD.
-- Spec: specs/2026-08-14-purchases-rce-module-spec.md
-- Additive only (memory hub-supabase-schema-not-reproducible: DROP nothing).
-- Tenancy: org_id text + app_ledger role + app.current_org_id GUC
-- (withOrgCore), matching every other pos_*/fin_* table. Idempotent.

create table if not exists public.fin_purchase_periods (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  period text not null,
  status text not null default 'open',
  doc_count integer not null default 0,
  base_gravada numeric,
  igv numeric,
  total numeric,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists fin_purchase_periods_org_period_uniq
  on public.fin_purchase_periods (org_id, period);
--> statement-breakpoint

create table if not exists public.fin_purchases (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source text not null,
  provider_ref text,
  period text not null,
  supplier_ruc text,
  supplier_name text,
  doc_type text,
  serie text,
  numero text,
  issued_at date,
  currency text,
  base_gravada numeric,
  igv numeric,
  total numeric,
  period_status text not null default 'open',
  sync_state text not null default 'local',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
-- Sunat-sourced rows dedupe on their SUNAT identity; manual rows have a null
-- provider_ref and are never subject to this constraint.
create unique index if not exists fin_purchases_org_provider_ref_uniq
  on public.fin_purchases (org_id, provider_ref) where provider_ref is not null;
--> statement-breakpoint
create index if not exists fin_purchases_org_period_idx
  on public.fin_purchases (org_id, period);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors pos.sql / pos_shadow_emission.sql) ──
grant select, insert, update, delete on public.fin_purchase_periods to app_ledger;
--> statement-breakpoint
alter table public.fin_purchase_periods enable row level security;
--> statement-breakpoint
alter table public.fin_purchase_periods force  row level security;
--> statement-breakpoint
create policy fin_purchase_periods_org_guc on public.fin_purchase_periods
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.fin_purchases to app_ledger;
--> statement-breakpoint
alter table public.fin_purchases enable row level security;
--> statement-breakpoint
alter table public.fin_purchases force  row level security;
--> statement-breakpoint
create policy fin_purchases_org_guc on public.fin_purchases
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
