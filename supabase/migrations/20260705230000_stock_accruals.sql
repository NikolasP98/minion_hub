-- Consumption accruals (potential vs real stock spend) + default warehouse.
-- A booking accrues expected consumption at creation (status 'open'); completing
-- realizes it into a posted stk_entry; cancel/no-show releases it. Parallel to
-- the real ledger — NEVER a ledger writer. Tenancy: org_id + app_ledger role +
-- app.current_org_id GUC (withOrgCore), same as 20260702130000_stock.sql.
-- Design: docs/superpowers/specs/2026-07-05-consumption-accrual-scheduling-stock-design.md.

create table if not exists public.stk_accruals (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  source            text not null,                 -- 'booking' (future: 'order')
  source_id         uuid not null,                 -- e.g. sched_bookings.id
  fin_product_id    uuid,                          -- soft ref → fin_products
  item_id           uuid not null references public.stk_items (id) on delete cascade,
  warehouse_id      uuid not null references public.stk_warehouses (id),
  qty_consumption   numeric not null,              -- expected, consumption uom
  qty               numeric not null,              -- expected, stock uom
  est_unit_cost     numeric not null default 0,    -- moving-avg cost at accrual time
  est_value         numeric not null default 0,    -- qty * est_unit_cost
  status            text not null default 'open',  -- open | realized | released
  realized_entry_id uuid,
  realized_qty      numeric,
  realized_value    numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  realized_at       timestamptz,
  released_at       timestamptz
);
--> statement-breakpoint
create unique index if not exists stk_accruals_org_source_item_uniq
  on public.stk_accruals (org_id, source, source_id, item_id);
--> statement-breakpoint
create index if not exists stk_accruals_org_status_idx on public.stk_accruals (org_id, status);
--> statement-breakpoint
create index if not exists stk_accruals_org_item_wh_status_idx
  on public.stk_accruals (org_id, item_id, warehouse_id, status);
--> statement-breakpoint
create index if not exists stk_accruals_source_idx on public.stk_accruals (source, source_id);
--> statement-breakpoint
grant select, insert, update, delete on public.stk_accruals to app_ledger;
--> statement-breakpoint
alter table public.stk_accruals enable row level security;
--> statement-breakpoint
alter table public.stk_accruals force  row level security;
--> statement-breakpoint
create policy stk_accruals_org_guc on public.stk_accruals
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

-- Default warehouse: accrual paths (booking create, agent actions) carry no
-- warehouse input; the org's flagged default (else earliest-created) is used.
alter table public.stk_warehouses add column if not exists is_default boolean not null default false;
--> statement-breakpoint
create unique index if not exists stk_warehouses_default_one_per_org
  on public.stk_warehouses (org_id) where is_default;
