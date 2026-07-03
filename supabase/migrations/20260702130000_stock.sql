-- Stock management module (P5, ERPNext-based). Immutable stock ledger +
-- cached bins + document-driven movements. See specs/2026-07-02-hub-erp-
-- agent-native-audit.md §7 and specs/hub-erp-roadmap/P5-stock-module.md.
--
-- Six tables: stk_items, stk_warehouses, stk_entries, stk_entry_lines,
-- stk_ledger (append-only — the source of truth), stk_bins (rebuildable
-- cache). Tenancy: org_id text + the app_ledger role + app.current_org_id GUC
-- (withOrgCore), same as party/naming_series/sales. Idempotent.

-- ── stk_items ────────────────────────────────────────────────────────────────
create table if not exists public.stk_items (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  code             text not null,
  name             text not null,
  uom              text not null default 'unit',
  item_group       text,
  is_stock_item    boolean not null default true,
  reorder_level    numeric,
  reorder_qty      numeric,
  valuation_method text not null default 'moving_avg',   -- v1: moving_avg only
  fin_product_id   uuid,                                  -- soft ref → fin_products
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists stk_items_org_code_uniq on public.stk_items (org_id, code);
--> statement-breakpoint
create index if not exists stk_items_org_idx on public.stk_items (org_id);
--> statement-breakpoint

-- ── stk_warehouses ───────────────────────────────────────────────────────────
create table if not exists public.stk_warehouses (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null,
  name       text not null,
  parent_id  uuid references public.stk_warehouses (id),   -- tree; cycle-guarded in service
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists stk_warehouses_org_idx on public.stk_warehouses (org_id);
--> statement-breakpoint
create index if not exists stk_warehouses_org_parent_idx on public.stk_warehouses (org_id, parent_id);
--> statement-breakpoint

-- ── stk_entries (document header; draft → submitted → cancelled) ────────────
create table if not exists public.stk_entries (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null,
  human_id   text,                                -- naming_series, stamped at submit (STE-YYYY-#####)
  type       text not null,                        -- receipt | issue | transfer | adjustment
  status     text not null default 'draft',        -- draft | submitted | cancelled
  party_id   uuid,                                 -- soft ref → parties (supplier/customer)
  note       text,
  posted_at  timestamptz,                          -- set at submit
  created_by text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists stk_entries_org_human_id_uniq
  on public.stk_entries (org_id, human_id) where human_id is not null;
--> statement-breakpoint
create index if not exists stk_entries_org_status_idx on public.stk_entries (org_id, status);
--> statement-breakpoint
create index if not exists stk_entries_org_created_idx on public.stk_entries (org_id, created_at);
--> statement-breakpoint

-- ── stk_entry_lines (org_id denormalized from the parent entry for RLS) ─────
create table if not exists public.stk_entry_lines (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null,
  entry_id           uuid not null references public.stk_entries (id) on delete cascade,
  item_id            uuid not null references public.stk_items (id),
  qty                numeric not null,
  uom                text,
  rate               numeric,
  from_warehouse_id  uuid references public.stk_warehouses (id),
  to_warehouse_id    uuid references public.stk_warehouses (id),
  line_no            integer not null default 0
);
--> statement-breakpoint
create index if not exists stk_entry_lines_entry_idx on public.stk_entry_lines (entry_id);
--> statement-breakpoint
create index if not exists stk_entry_lines_org_idx on public.stk_entry_lines (org_id);
--> statement-breakpoint

-- ── stk_ledger — APPEND-ONLY. Only submitEntry/cancelEntry write here, and
-- never update/delete a row (cancel inserts a reversing row). `id` is a
-- bigserial (not uuid) so it doubles as the strict total order rebuildBins
-- replays on. `qty_after`/`valuation_rate` are the resulting BIN snapshot
-- immediately after this row — rebuildBins just takes the latest row per
-- (item, warehouse), no re-derivation needed. ─────────────────────────────
create table if not exists public.stk_ledger (
  id              bigserial primary key,
  org_id          text not null,
  item_id         uuid not null references public.stk_items (id),
  warehouse_id    uuid not null references public.stk_warehouses (id),
  entry_id        uuid not null references public.stk_entries (id),
  qty_delta       numeric not null,
  qty_after       numeric not null,
  valuation_rate  numeric not null,
  value_delta     numeric not null,
  posted_at       timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists stk_ledger_org_item_posted_idx on public.stk_ledger (org_id, item_id, posted_at);
--> statement-breakpoint
create index if not exists stk_ledger_entry_idx on public.stk_ledger (entry_id);
--> statement-breakpoint

-- ── stk_bins — rebuildable cache (PK doubles as the natural lookup index) ──
create table if not exists public.stk_bins (
  org_id         text not null,
  item_id        uuid not null references public.stk_items (id),
  warehouse_id   uuid not null references public.stk_warehouses (id),
  qty            numeric not null default 0,
  valuation_rate numeric not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (org_id, item_id, warehouse_id)
);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors party/sales) ──
grant select, insert, update, delete on public.stk_items to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.stk_warehouses to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.stk_entries to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.stk_entry_lines to app_ledger;
--> statement-breakpoint
-- Ledger is append-only: NO update/delete grant (mirrors notif_log). RLS
-- policy below is still `for all` for simplicity, but the missing grants make
-- UPDATE/DELETE fail at the privilege layer regardless of policy.
grant select, insert on public.stk_ledger to app_ledger;
--> statement-breakpoint
-- bigserial inserts need the sequence, or app_ledger INSERTs fail at runtime.
grant usage, select on sequence public.stk_ledger_id_seq to app_ledger;
--> statement-breakpoint
-- Bins are a rebuildable cache — full CRUD (rebuildBins deletes + reinserts).
grant select, insert, update, delete on public.stk_bins to app_ledger;
--> statement-breakpoint

alter table public.stk_items       enable row level security;
--> statement-breakpoint
alter table public.stk_items       force  row level security;
--> statement-breakpoint
alter table public.stk_warehouses  enable row level security;
--> statement-breakpoint
alter table public.stk_warehouses  force  row level security;
--> statement-breakpoint
alter table public.stk_entries     enable row level security;
--> statement-breakpoint
alter table public.stk_entries     force  row level security;
--> statement-breakpoint
alter table public.stk_entry_lines enable row level security;
--> statement-breakpoint
alter table public.stk_entry_lines force  row level security;
--> statement-breakpoint
alter table public.stk_ledger      enable row level security;
--> statement-breakpoint
alter table public.stk_ledger      force  row level security;
--> statement-breakpoint
alter table public.stk_bins        enable row level security;
--> statement-breakpoint
alter table public.stk_bins        force  row level security;
--> statement-breakpoint

create policy stk_items_org_guc on public.stk_items
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy stk_warehouses_org_guc on public.stk_warehouses
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy stk_entries_org_guc on public.stk_entries
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy stk_entry_lines_org_guc on public.stk_entry_lines
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy stk_ledger_org_guc on public.stk_ledger
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy stk_bins_org_guc on public.stk_bins
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
