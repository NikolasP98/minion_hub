-- POS module: settings, cash shifts, tickets, lines, payments.
-- Spec: docs/superpowers/specs/2026-07-07-pos-module-design.md
-- Tenancy: org_id text + the app_ledger role + app.current_org_id GUC
-- (withOrgCore), same as stock/sales/party. Idempotent.

create table if not exists public.pos_settings (
  org_id text primary key,
  methods jsonb not null default '["cash","card","yape","plin","transfer"]',
  currency text not null default 'PEN',
  require_customer boolean not null default false,
  allow_price_override boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint

create table if not exists public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  status text not null default 'open',
  opened_by uuid,
  opened_at timestamptz not null default now(),
  opening_float jsonb not null default '{}',
  closed_by uuid,
  closed_at timestamptz,
  expected jsonb,
  counted jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists pos_shifts_one_open_per_org
  on public.pos_shifts (org_id) where status = 'open';
--> statement-breakpoint

create table if not exists public.pos_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  human_id text,
  shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  party_id uuid,
  crm_contact_id uuid,
  customer_name text,
  status text not null default 'submitted',
  subtotal numeric not null,
  discount numeric not null default 0,
  total numeric not null,
  currency text not null default 'PEN',
  note text,
  stock_entry_id uuid,
  stock_warning jsonb,
  invoice_provider_ref text,
  created_by uuid,
  submitted_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  metadata jsonb not null default '{}'
);
--> statement-breakpoint
create index if not exists pos_tickets_org_submitted_idx on public.pos_tickets (org_id, submitted_at);
--> statement-breakpoint
create index if not exists pos_tickets_org_shift_idx on public.pos_tickets (org_id, shift_id);
--> statement-breakpoint
create index if not exists pos_tickets_org_party_idx on public.pos_tickets (org_id, party_id);
--> statement-breakpoint

create table if not exists public.pos_ticket_lines (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  kind text not null,
  fin_product_id uuid,
  booking_id uuid,
  description text not null,
  qty numeric not null,
  unit_price numeric not null,
  discount numeric not null default 0,
  total numeric not null,
  line_no integer not null default 0
);
--> statement-breakpoint
create index if not exists pos_ticket_lines_org_ticket_idx on public.pos_ticket_lines (org_id, ticket_id);
--> statement-breakpoint
create index if not exists pos_ticket_lines_org_product_idx on public.pos_ticket_lines (org_id, fin_product_id);
--> statement-breakpoint

create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  shift_id uuid not null,
  method text not null,
  amount numeric not null,
  tendered numeric,
  paid_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
--> statement-breakpoint
create index if not exists pos_payments_org_shift_idx on public.pos_payments (org_id, shift_id);
--> statement-breakpoint
create index if not exists pos_payments_ticket_idx on public.pos_payments (ticket_id);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors stock/sales) ──
grant select, insert, update, delete on public.pos_settings to app_ledger;
--> statement-breakpoint
alter table public.pos_settings enable row level security;
--> statement-breakpoint
alter table public.pos_settings force  row level security;
--> statement-breakpoint
create policy pos_settings_org_guc on public.pos_settings
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_shifts to app_ledger;
--> statement-breakpoint
alter table public.pos_shifts enable row level security;
--> statement-breakpoint
alter table public.pos_shifts force  row level security;
--> statement-breakpoint
create policy pos_shifts_org_guc on public.pos_shifts
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_tickets to app_ledger;
--> statement-breakpoint
alter table public.pos_tickets enable row level security;
--> statement-breakpoint
alter table public.pos_tickets force  row level security;
--> statement-breakpoint
create policy pos_tickets_org_guc on public.pos_tickets
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_ticket_lines to app_ledger;
--> statement-breakpoint
alter table public.pos_ticket_lines enable row level security;
--> statement-breakpoint
alter table public.pos_ticket_lines force  row level security;
--> statement-breakpoint
create policy pos_ticket_lines_org_guc on public.pos_ticket_lines
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_payments to app_ledger;
--> statement-breakpoint
alter table public.pos_payments enable row level security;
--> statement-breakpoint
alter table public.pos_payments force  row level security;
--> statement-breakpoint
create policy pos_payments_org_guc on public.pos_payments
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
