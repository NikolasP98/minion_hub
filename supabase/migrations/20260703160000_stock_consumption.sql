-- P5.1 stock interconnect: consumption map — fin_product (service/product sold)
-- → stk_items consumed per unit sold/performed. Completes the catalog triangle
-- sched_event_types.product_id → fin_products ← stk_items.fin_product_id.
-- Design: specs/hub-erp-roadmap/P5.1-stock-interconnect-seed.md

create table if not exists public.stk_consumption (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  fin_product_id uuid not null,
  item_id        uuid not null references public.stk_items(id) on delete cascade,
  qty_per_unit   numeric not null,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, fin_product_id, item_id)
);
--> statement-breakpoint
create index if not exists stk_consumption_org_product_idx
  on public.stk_consumption (org_id, fin_product_id);
--> statement-breakpoint

grant select, insert, update, delete on public.stk_consumption to app_ledger;
--> statement-breakpoint
alter table public.stk_consumption enable row level security;
--> statement-breakpoint
alter table public.stk_consumption force  row level security;
--> statement-breakpoint
create policy stk_consumption_org_guc on public.stk_consumption
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
