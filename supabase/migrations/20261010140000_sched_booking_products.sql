-- Slice 4 of 2026-10-10-hub-catalog-service-unification: products on an
-- event. A new table, not a backfill — there is no prior data to migrate.
create table if not exists public.sched_booking_products (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  booking_id uuid not null references public.sched_bookings(id) on delete cascade,
  product_id uuid not null references public.fin_products(id) on delete restrict,
  qty numeric not null default 1 check (qty > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sched_booking_products_booking_product_uniq unique (booking_id, product_id)
);
--> statement-breakpoint
create index if not exists sched_booking_products_org_booking_idx
  on public.sched_booking_products (org_id, booking_id);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors every other sched_* table) ──
grant select, insert, update, delete on public.sched_booking_products to app_ledger;
--> statement-breakpoint
alter table public.sched_booking_products enable row level security;
--> statement-breakpoint
alter table public.sched_booking_products force row level security;
--> statement-breakpoint
drop policy if exists sched_booking_products_org_guc on public.sched_booking_products;
--> statement-breakpoint
create policy sched_booking_products_org_guc on public.sched_booking_products
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
