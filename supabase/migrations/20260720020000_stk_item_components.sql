-- Item composition graph (item spine Slice 1b, task #5).
--
-- A self-referential DAG over stk_items: "items build products/services".
-- potatoes/milk/salt -> mashed potatoes -> (chicken + batter + sauce -> fried
-- chicken) -> a full plate. ANY node can be sold on its own (sellability is
-- stk_items.fin_product_id, not a level in this graph).
--
-- COMPOSITION ONLY — what a thing IS. What a CUSTOMER chose (exclude the salt,
-- add a drink) is configuration and belongs on the order line; modelling that
-- here would mint one item per combination.
--
-- `optional` + `default_included` + `choice_group` are here from day one
-- because retrofitting them onto a populated graph is far more expensive than
-- carrying three nullable columns now:
--   optional          — the edge may be dropped/added per order line
--   default_included  — whether an optional edge is on by default
--   choice_group      — edges sharing a tag are alternatives (pick from the set)
-- Quantity BOUNDS (min/max per choice group) are deliberately deferred until a
-- real menu needs them; they are additive nullable columns whenever that lands.
--
-- Cycles are rejected at write time (stock.logic.wouldCreateComponentCycle);
-- the rollup also carries a path guard so bad data can never hang a request.
create table if not exists public.stk_item_components (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  parent_item_id   uuid not null references public.stk_items(id) on delete cascade,
  -- restrict, not cascade: deleting a raw material that a recipe still uses
  -- must fail loudly rather than silently gut the recipe.
  child_item_id    uuid not null references public.stk_items(id) on delete restrict,
  qty              numeric not null,
  optional         boolean not null default false,
  default_included boolean not null default true,
  choice_group     text,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint stk_item_components_no_self check (parent_item_id <> child_item_id),
  unique (org_id, parent_item_id, child_item_id)
);
--> statement-breakpoint
create index if not exists stk_item_components_org_parent_idx
  on public.stk_item_components (org_id, parent_item_id);
--> statement-breakpoint
create index if not exists stk_item_components_org_child_idx
  on public.stk_item_components (org_id, child_item_id);
--> statement-breakpoint

grant select, insert, update, delete on public.stk_item_components to app_ledger;
--> statement-breakpoint
alter table public.stk_item_components enable row level security;
--> statement-breakpoint
alter table public.stk_item_components force  row level security;
--> statement-breakpoint
create policy stk_item_components_org_guc on public.stk_item_components
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
