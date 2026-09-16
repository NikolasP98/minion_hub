-- Session packages, payment plans and the per-client credit ledger.
-- Spec: specs/2026-09-13-pos-scheduling-packages-payment-plans-spec.md §2 (slice S1).
--
-- Two directions of the same money<->calendar relationship:
--   one payment -> N sessions   (pos_package_grants + pos_package_redemptions)
--   N payments  -> one treatment (pos_payment_plans, paid by N balanced tickets)
-- plus stored value per client (pos_client_ledger) that both lean on.
--
-- Tenancy: org_id text + the app_ledger role + app.current_org_id GUC
-- (withOrgCore), forced RLS — same shape as 20260707120000_pos.sql and
-- 20260725030000_fin_product_components.sql. Idempotent.
--
-- Deliberately NOT stored: sessions used (derived from non-reversed redemption
-- rows) and paid-to-date (derived from non-void ticket lines carrying plan_id).
-- A running counter is a drift bug waiting for a partial failure.

create table if not exists public.pos_client_ledger (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  -- Client identity: the shared party spine and/or the CRM facet. Soft refs
  -- (no FK), matching pos_tickets.party_id / crm_contact_id.
  party_id       uuid,
  crm_contact_id uuid,
  kind           text not null,
  -- SIGNED: positive adds credit, negative consumes it. Balance = sum(amount).
  amount         numeric(12,2) not null,
  currency       text not null default 'PEN',
  -- Provenance, all soft refs: an append-only money trail must survive the
  -- deletion of anything it points at, so no FK/cascade here on purpose.
  ticket_id      uuid,
  plan_id        uuid,
  booking_id     uuid,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  metadata       jsonb not null default '{}',
  constraint pos_client_ledger_client_chk
    check (party_id is not null or crm_contact_id is not null),
  constraint pos_client_ledger_kind_chk
    check (kind in ('topup', 'deposit', 'redemption', 'refund', 'adjustment')),
  -- A zero-amount row moves no money and only adds noise to the balance trail.
  constraint pos_client_ledger_amount_chk check (amount <> 0)
);
--> statement-breakpoint
create index if not exists pos_client_ledger_org_contact_idx
  on public.pos_client_ledger (org_id, crm_contact_id);
--> statement-breakpoint
create index if not exists pos_client_ledger_org_party_idx
  on public.pos_client_ledger (org_id, party_id);
--> statement-breakpoint

create table if not exists public.pos_payment_plans (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  party_id       uuid,
  crm_contact_id uuid,
  title          text not null,
  total_amount   numeric(12,2) not null,
  currency       text not null default 'PEN',
  status         text not null default 'open',
  -- The treatment being paid for (fin_products.id) and the event it funds
  -- (sched_bookings.id). Soft refs — scheduling is a separate module.
  product_id     uuid,
  booking_id     uuid,
  -- Advisory only: [{ dueOn: 'YYYY-MM-DD', amount: number }]. Nothing
  -- auto-charges; card-on-file is explicitly out of scope (spec §6).
  due_schedule   jsonb,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  constraint pos_payment_plans_client_chk
    check (party_id is not null or crm_contact_id is not null),
  constraint pos_payment_plans_status_chk
    check (status in ('open', 'settled', 'cancelled')),
  constraint pos_payment_plans_total_chk check (total_amount > 0)
);
--> statement-breakpoint
create index if not exists pos_payment_plans_org_status_idx
  on public.pos_payment_plans (org_id, status);
--> statement-breakpoint
create index if not exists pos_payment_plans_org_contact_idx
  on public.pos_payment_plans (org_id, crm_contact_id);
--> statement-breakpoint
create index if not exists pos_payment_plans_org_party_idx
  on public.pos_payment_plans (org_id, party_id);
--> statement-breakpoint
create index if not exists pos_payment_plans_org_booking_idx
  on public.pos_payment_plans (org_id, booking_id);
--> statement-breakpoint

create table if not exists public.pos_package_grants (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null,
  party_id           uuid,
  crm_contact_id     uuid,
  -- In-module structural refs: restrict, never cascade. A grant outliving the
  -- ticket that sold it would be unauditable, so deleting that ticket must
  -- fail loudly instead.
  source_ticket_id   uuid not null references public.pos_tickets(id) on delete restrict,
  source_line_id     uuid not null references public.pos_ticket_lines(id) on delete restrict,
  -- The bundle sellable and the child service it delivers (fin_products.id,
  -- via fin_product_components edges). Soft refs, like pos_ticket_lines.
  package_product_id uuid not null,
  service_product_id uuid not null,
  sessions_total     integer not null,
  -- Price allocated per session: revenue recognition, and the visible value of
  -- a redeemed line priced at 0.
  unit_value         numeric(12,2) not null default 0,
  expires_at         date,
  status             text not null default 'active',
  created_at         timestamptz not null default now(),
  cancelled_at       timestamptz,
  cancelled_by       uuid,
  constraint pos_package_grants_client_chk
    check (party_id is not null or crm_contact_id is not null),
  constraint pos_package_grants_status_chk
    check (status in ('active', 'exhausted', 'expired', 'cancelled')),
  constraint pos_package_grants_sessions_chk check (sessions_total > 0),
  constraint pos_package_grants_unit_value_chk check (unit_value >= 0)
);
--> statement-breakpoint
create index if not exists pos_package_grants_org_contact_idx
  on public.pos_package_grants (org_id, crm_contact_id);
--> statement-breakpoint
create index if not exists pos_package_grants_org_party_idx
  on public.pos_package_grants (org_id, party_id);
--> statement-breakpoint
create index if not exists pos_package_grants_org_ticket_idx
  on public.pos_package_grants (org_id, source_ticket_id);
--> statement-breakpoint

create table if not exists public.pos_package_redemptions (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  grant_id       uuid not null references public.pos_package_grants(id) on delete restrict,
  -- The booking that drew the session down, and (later) the ticket line the
  -- redemption was billed on at 0. Soft refs across modules.
  booking_id     uuid,
  ticket_id      uuid,
  ticket_line_id uuid,
  redeemed_at    timestamptz not null default now(),
  redeemed_by    uuid,
  -- A reversal is `reversed_at`, never a delete: sessions used is
  -- count(*) where reversed_at is null.
  reversed_at    timestamptz,
  reversed_by    uuid,
  reversal_reason text
);
--> statement-breakpoint
create index if not exists pos_package_redemptions_org_grant_idx
  on public.pos_package_redemptions (org_id, grant_id);
--> statement-breakpoint
create index if not exists pos_package_redemptions_org_booking_idx
  on public.pos_package_redemptions (org_id, booking_id);
--> statement-breakpoint
create index if not exists pos_package_redemptions_org_ticket_idx
  on public.pos_package_redemptions (org_id, ticket_id);
--> statement-breakpoint
-- One LIVE redemption per booking: re-redeeming the same appointment (a retry,
-- a double-submit) can never drain a second session.
create unique index if not exists pos_package_redemptions_live_booking_uniq
  on public.pos_package_redemptions (org_id, booking_id)
  where booking_id is not null and reversed_at is null;
--> statement-breakpoint

-- Status history for the booking detail drawer (spec §4.1). Append-only.
create table if not exists public.sched_booking_status_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  booking_id  uuid not null,
  from_status text,
  to_status   text not null,
  reason      text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists sched_booking_status_log_org_booking_idx
  on public.sched_booking_status_log (org_id, booking_id, changed_at);
--> statement-breakpoint

-- ── column additions (spec §2.4) ──────────────────────────────────────────

-- An instalment line (plan_id) and a line paid by a package session
-- (redemption_id). Soft refs: a ticket line is history and must never be
-- cascade-deleted by a plan or grant cleanup.
alter table public.pos_ticket_lines
  add column if not exists plan_id uuid,
  add column if not exists redemption_id uuid;
--> statement-breakpoint
-- Partial: only instalment lines are ever scanned, and paid-to-date sums them
-- per plan on every plan read.
create index if not exists pos_ticket_lines_org_plan_idx
  on public.pos_ticket_lines (org_id, plan_id) where plan_id is not null;
--> statement-breakpoint
create index if not exists pos_ticket_lines_org_redemption_idx
  on public.pos_ticket_lines (org_id, redemption_id) where redemption_id is not null;
--> statement-breakpoint

-- sched_bookings lives in the scheduling module (its create-table migration is
-- not in this directory — see CLAUDE.md on the schema not being reproducible
-- from the repo alone). Additive columns only.
alter table public.sched_bookings
  add column if not exists package_grant_id uuid,
  add column if not exists payment_plan_id uuid,
  add column if not exists series_id uuid,
  add column if not exists series_index integer,
  add column if not exists client_note text;
--> statement-breakpoint
create index if not exists sched_bookings_org_series_idx
  on public.sched_bookings (org_id, series_id, series_index) where series_id is not null;
--> statement-breakpoint
create index if not exists sched_bookings_org_grant_idx
  on public.sched_bookings (org_id, package_grant_id) where package_grant_id is not null;
--> statement-breakpoint
create index if not exists sched_bookings_org_plan_idx
  on public.sched_bookings (org_id, payment_plan_id) where payment_plan_id is not null;
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors pos_*) ───────

grant select, insert, update, delete on public.pos_client_ledger to app_ledger;
--> statement-breakpoint
alter table public.pos_client_ledger enable row level security;
--> statement-breakpoint
alter table public.pos_client_ledger force  row level security;
--> statement-breakpoint
drop policy if exists pos_client_ledger_org_guc on public.pos_client_ledger;
--> statement-breakpoint
create policy pos_client_ledger_org_guc on public.pos_client_ledger
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_payment_plans to app_ledger;
--> statement-breakpoint
alter table public.pos_payment_plans enable row level security;
--> statement-breakpoint
alter table public.pos_payment_plans force  row level security;
--> statement-breakpoint
drop policy if exists pos_payment_plans_org_guc on public.pos_payment_plans;
--> statement-breakpoint
create policy pos_payment_plans_org_guc on public.pos_payment_plans
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_package_grants to app_ledger;
--> statement-breakpoint
alter table public.pos_package_grants enable row level security;
--> statement-breakpoint
alter table public.pos_package_grants force  row level security;
--> statement-breakpoint
drop policy if exists pos_package_grants_org_guc on public.pos_package_grants;
--> statement-breakpoint
create policy pos_package_grants_org_guc on public.pos_package_grants
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.pos_package_redemptions to app_ledger;
--> statement-breakpoint
alter table public.pos_package_redemptions enable row level security;
--> statement-breakpoint
alter table public.pos_package_redemptions force  row level security;
--> statement-breakpoint
drop policy if exists pos_package_redemptions_org_guc on public.pos_package_redemptions;
--> statement-breakpoint
create policy pos_package_redemptions_org_guc on public.pos_package_redemptions
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

grant select, insert, update, delete on public.sched_booking_status_log to app_ledger;
--> statement-breakpoint
alter table public.sched_booking_status_log enable row level security;
--> statement-breakpoint
alter table public.sched_booking_status_log force  row level security;
--> statement-breakpoint
drop policy if exists sched_booking_status_log_org_guc on public.sched_booking_status_log;
--> statement-breakpoint
create policy sched_booking_status_log_org_guc on public.sched_booking_status_log
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
