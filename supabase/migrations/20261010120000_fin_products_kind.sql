-- Catalog item kind is operator-chosen, not derived (spec 2026-10-10-hub-catalog-service-unification, Slice 1).
--
-- Until now `SellableRow.kind` was a projection of the stock link: a fin_product with a
-- linked stk_items row read as 'product', one with fin_product_components read as 'bundle',
-- anything else as 'service'. The owner's model is a recipe book where the operator says
-- what each entry IS: a service (schedulable, composed of products and/or services) or a
-- product (composed of products only). This column stores that choice. "Package" stays a
-- derived caption (a service with service components), not a third kind.
--
-- Backfill = the old derivation, so no existing row changes meaning on deploy.
alter table fin_products
  add column if not exists kind text not null default 'service';

alter table fin_products
  drop constraint if exists fin_products_kind_check;
alter table fin_products
  add constraint fin_products_kind_check check (kind in ('service', 'product'));

update fin_products p
   set kind = 'product'
 where p.kind <> 'product'
   and exists (select 1 from stk_items i where i.fin_product_id = p.id and i.org_id = p.org_id);

-- A product cannot be composed of services (invariant I2). Bundles never carried a stock
-- item, so after the backfill above this must hold; fail loudly rather than ship a row the
-- composition rule would refuse to edit.
do $$
declare bad int;
begin
  select count(*) into bad
    from fin_products p
   where p.kind = 'product'
     and exists (select 1 from fin_product_components c where c.bundle_product_id = p.id);
  if bad > 0 then
    raise exception 'fin_products_kind backfill: % product-kind rows have service components', bad;
  end if;
end $$;

create index if not exists fin_products_org_kind_idx on fin_products (org_id, kind);
