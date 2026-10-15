-- Accounting period locks (spec 2026-10-15-hub-pos-shift-scoped-edits-and-
-- emission-on-close T4). Once the accountant locks a month, every POS mutation
-- on a ticket submitted in that month (tender change, void, re-emission) is
-- refused with 423 "Periodo cerrado por contabilidad". The month is read in
-- the org's accounting timezone (fin_settings.timezone), never UTC.
create table if not exists public.pos_period_locks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  -- 'YYYY-MM'
  period text not null,
  locked_by uuid,
  locked_at timestamptz not null default now(),
  note text,
  constraint pos_period_locks_org_period_uniq unique (org_id, period),
  constraint pos_period_locks_period_format check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
alter table public.pos_period_locks enable row level security;
--> statement-breakpoint
alter table public.pos_period_locks force row level security;
--> statement-breakpoint
grant select, insert, update, delete on public.pos_period_locks to app_ledger;
--> statement-breakpoint
create policy pos_period_locks_org_guc on public.pos_period_locks
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
