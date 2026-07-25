-- Product bundles — the third layer of the catalog spine.
--
--   stk_items          raw materials + recipes  (item -> item, stk_item_components)
--   fin_products       what a customer buys     (a service, or a published item)
--   fin_product_components  a BUNDLE            (product -> product, this table)
--
-- "Dúo MIFILL" is the shape: one sellable line at one price that delivers two
-- other sellables. Deliberately a separate table from stk_item_components even
-- though the graphs rhyme — that one composes MATERIALS (what a thing is made
-- of, in stock UOM), this one composes SELLABLES (what an offer contains, in
-- whole units). Merging them would force every service into stk_items just to
-- be bundleable.
--
-- `kind` stays DERIVED, never stored: a product is a bundle iff it has rows
-- here, exactly as it is a 'product' iff a stk_items row links to it. See
-- mapSellableRow in pos.service.ts.
--
-- NOT modelled yet, on purpose: CHOICE slots ("pick any two zones"). If Dúo
-- MIFILL turns out to be an operator choice rather than a fixed pair, that is a
-- `choice_group` column here plus a selected-children snapshot on
-- pos_ticket_lines — additive, and not worth guessing at before the business
-- confirms which of the two it is.
create table if not exists public.fin_product_components (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  bundle_product_id uuid not null references public.fin_products(id) on delete cascade,
  -- restrict, not cascade: deleting a service that a bundle still sells must
  -- fail loudly rather than silently shrink the bundle's contents.
  child_product_id  uuid not null references public.fin_products(id) on delete restrict,
  qty               numeric not null default 1,
  line_no           integer not null default 0,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fin_product_components_no_self check (bundle_product_id <> child_product_id),
  constraint fin_product_components_qty_pos check (qty > 0),
  unique (org_id, bundle_product_id, child_product_id)
);
--> statement-breakpoint
create index if not exists fin_product_components_org_bundle_idx
  on public.fin_product_components (org_id, bundle_product_id);
--> statement-breakpoint
create index if not exists fin_product_components_org_child_idx
  on public.fin_product_components (org_id, child_product_id);
--> statement-breakpoint

grant select, insert, update, delete on public.fin_product_components to app_ledger;
--> statement-breakpoint
alter table public.fin_product_components enable row level security;
--> statement-breakpoint
alter table public.fin_product_components force  row level security;
--> statement-breakpoint
create policy fin_product_components_org_guc on public.fin_product_components
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
