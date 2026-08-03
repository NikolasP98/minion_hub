-- Personal-finance statement imports (WP4, R4/R5 — specs/2026-07-22-personal-
-- org-differentiation-spec.md). NEW tables, deliberately separate from
-- fin_invoices (a sales document, not a bank-statement transaction).
-- Tenancy: org_id text + app_ledger role + app.current_org_id GUC
-- (withOrgCore), matching every other fin_*/pos_* table. Idempotent.

create table if not exists public.fin_statement_imports (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  file_id text,                        -- bridges to files.id (cuid2 text)
  source_kind text not null,           -- 'csv' | 'text'
  content_sha256 text not null,
  parser_version integer not null,
  status text not null default 'queued', -- queued|parsing|done|failed|undone
  next_chunk integer not null default 0, -- resumable cursor for statement_ingest
  row_count integer,
  inserted_count integer,
  rejected_count integer,
  error_code text,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
--> statement-breakpoint
create unique index if not exists fin_statement_imports_org_sha_uniq
  on public.fin_statement_imports (org_id, content_sha256);
--> statement-breakpoint
create index if not exists fin_statement_imports_org_idx
  on public.fin_statement_imports (org_id, created_at);
--> statement-breakpoint
-- Composite FK target so fin_transactions can enforce same-org parentage
-- (RLS alone checks the transaction's org_id, not the referenced import's).
create unique index if not exists fin_statement_imports_org_id_uniq
  on public.fin_statement_imports (org_id, id);
--> statement-breakpoint

create table if not exists public.fin_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  import_id uuid not null,
  source_row integer not null,
  posted_on date not null,
  description text not null,
  signed_amount numeric(18,2) not null, -- sign = direction; no separate direction column
  currency text,
  counterparty text,
  category text,
  reference text,
  party_id uuid,                        -- soft bridge to parties.id (no FK, matches fin_clients.party_id)
  confidence numeric,
  warnings jsonb not null default '[]',
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint fin_transactions_org_import_fk
    foreign key (org_id, import_id)
    references public.fin_statement_imports (org_id, id)
    on delete cascade
);
--> statement-breakpoint
create unique index if not exists fin_transactions_import_row_uniq
  on public.fin_transactions (import_id, source_row);
--> statement-breakpoint
create index if not exists fin_transactions_org_posted_idx
  on public.fin_transactions (org_id, posted_on desc);
--> statement-breakpoint
create index if not exists fin_transactions_party_idx
  on public.fin_transactions (party_id);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors pos.sql) ──
grant select, insert, update, delete on public.fin_statement_imports to app_ledger;
--> statement-breakpoint
alter table public.fin_statement_imports enable row level security;
--> statement-breakpoint
alter table public.fin_statement_imports force  row level security;
--> statement-breakpoint
create policy fin_statement_imports_org_guc on public.fin_statement_imports
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.fin_transactions to app_ledger;
--> statement-breakpoint
alter table public.fin_transactions enable row level security;
--> statement-breakpoint
alter table public.fin_transactions force  row level security;
--> statement-breakpoint
create policy fin_transactions_org_guc on public.fin_transactions
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
