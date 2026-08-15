-- POS shadow emission: serie/correlativo allocator + emission attempts.
-- Spec: specs/2026-08-14-pos-shadow-emission-spec.md
-- Additive only (memory hub-supabase-schema-not-reproducible: DROP nothing).
-- Tenancy: org_id text + app_ledger role + app.current_org_id GUC
-- (withOrgCore), matching every other pos_*/fin_* table. Idempotent.

alter table public.pos_settings
  add column if not exists emission jsonb not null default '{"mode":"off","docTypeDefault":"03"}';
--> statement-breakpoint

create table if not exists public.pos_series (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  doc_type text not null,
  serie text not null,
  next_number integer not null default 1,
  environment text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists pos_series_org_doc_serie_uniq
  on public.pos_series (org_id, doc_type, serie);
--> statement-breakpoint
-- One active serie per (org, doc_type, environment) — a prod serie must never
-- be consumed by shadow, and shadow must never accidentally double-allocate.
create unique index if not exists pos_series_one_active_per_env
  on public.pos_series (org_id, doc_type, environment) where active;
--> statement-breakpoint

create table if not exists public.pos_emissions (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  ticket_id uuid not null references public.pos_tickets(id) on delete restrict,
  doc_type text not null,
  serie text not null,
  correlativo integer not null,
  environment text not null,
  status text not null default 'pending',
  response_code text,
  response_description text,
  xml_hash text,
  total numeric,
  client_doc_type text,
  client_doc_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists pos_emissions_org_doc_serie_correlativo_uniq
  on public.pos_emissions (org_id, doc_type, serie, correlativo);
--> statement-breakpoint
create index if not exists pos_emissions_org_ticket_idx
  on public.pos_emissions (org_id, ticket_id);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors pos.sql) ──
grant select, insert, update, delete on public.pos_series to app_ledger;
--> statement-breakpoint
alter table public.pos_series enable row level security;
--> statement-breakpoint
alter table public.pos_series force  row level security;
--> statement-breakpoint
create policy pos_series_org_guc on public.pos_series
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_emissions to app_ledger;
--> statement-breakpoint
alter table public.pos_emissions enable row level security;
--> statement-breakpoint
alter table public.pos_emissions force  row level security;
--> statement-breakpoint
create policy pos_emissions_org_guc on public.pos_emissions
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
