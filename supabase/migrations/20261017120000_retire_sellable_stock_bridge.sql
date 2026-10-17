-- One stock path per sellable: retire the hidden 1:1 stock bridge (meta spec 024).
--
-- A sellable used to reach stock two ways: its recipe (stk_consumption, the
-- "Supply consumption" rows the form shows) and a bridge
-- (stk_items.fin_product_id = fin_products.id, "the product IS this item") that
-- the form never showed. The recipe already outranked the bridge at sale time, so
-- the bridge only ever fired for a product with NO recipe. This migration turns
-- each such bridge into the recipe row it was standing in for, then clears every
-- bridge. Selling 1 unit deducts the same items and quantities before and after.
--
-- Units: the bridge issued 1 STOCK unit; recipe rows are in the item's
-- consumption unit, so the row is 1 × units_per_stock_uom (null ⇒ same unit ⇒ 1).
--
-- Reversible: every cleared link is kept in stk_items_fin_product_bridge_backup.
-- Idempotent: a second run finds no bridges and changes nothing.
--
-- TODO(handoff): drop stk_items.fin_product_id + stk_items_org_fin_product_uniq
-- (and the backup table) in a follow-up migration once a release has run with no
-- reader — meta specs/024-remove-sellable-stock-bridge "Out of scope".

create table if not exists stk_items_fin_product_bridge_backup (
  item_id uuid primary key,
  org_id text not null,
  fin_product_id uuid not null,
  had_recipe boolean not null,
  backed_up_at timestamptz not null default now()
);
alter table stk_items_fin_product_bridge_backup enable row level security;

insert into stk_items_fin_product_bridge_backup (item_id, org_id, fin_product_id, had_recipe)
select i.id, i.org_id, i.fin_product_id,
       exists (select 1 from stk_consumption c
                where c.org_id = i.org_id and c.fin_product_id = i.fin_product_id)
  from stk_items i
 where i.fin_product_id is not null
on conflict (item_id) do nothing;

-- Bridge-only sellables: the bridge WAS their stock path ⇒ write it as a recipe row.
insert into stk_consumption (org_id, fin_product_id, item_id, qty_per_unit, note)
select i.org_id, i.fin_product_id, i.id, coalesce(i.units_per_stock_uom, 1),
       'retired 1:1 stock link (spec 024)'
  from stk_items i
 where i.fin_product_id is not null
   and not exists (select 1 from stk_consumption c
                    where c.org_id = i.org_id and c.fin_product_id = i.fin_product_id)
on conflict (org_id, fin_product_id, item_id) do nothing;

update stk_items set fin_product_id = null where fin_product_id is not null;

-- INV-1: every sellable that had a bridge still reaches stock (now through a recipe).
do $$
declare lost int;
begin
  select count(*) into lost
    from stk_items_fin_product_bridge_backup b
   where not exists (select 1 from stk_consumption c
                      where c.org_id = b.org_id and c.fin_product_id = b.fin_product_id);
  if lost > 0 then
    raise exception 'retire_sellable_stock_bridge: % sellables lost their only stock path', lost;
  end if;
end $$;
