-- Confirmed business semantics for the seeded Hialuronidasa mapping:
--   10 mL consumed per procedure / 15 mL per stocked vial = 0.6667 vial.
--
-- Fresh databases may run migrations before the FACES seed, so no candidate
-- is a valid no-op; seed-stock-faces.ts carries the same configuration.
do $$
declare
  target record;
  derived_usage bigint;
  changed integer;
begin
  for target in
    select
    fp.org_id,
    fp.id as product_id,
    fp.active,
    si.id as item_id,
    si.uom,
    si.consumption_uom,
    si.units_per_stock_uom,
    sc.id as consumption_id,
    sc.qty_per_unit,
    sc.note
    from public.fin_products fp
    join public.stk_consumption sc
      on sc.org_id = fp.org_id
     and sc.fin_product_id = fp.id
    join public.stk_items si
      on si.org_id = sc.org_id
     and si.id = sc.item_id
     and si.fin_product_id = fp.id
    where fp.code = 'H'
      and fp.name = 'Hialuronidasa'
      and si.code = '1262'
      and si.name = 'Hialuronidasa'
    for update of fp, sc, si
  loop

  if target.uom <> 'Unidad'
     or target.qty_per_unit is distinct from 10::numeric
  then
    raise exception 'Hialuronidasa UOM/quantity preconditions changed for org %; aborting', target.org_id;
  end if;

  -- Idempotent desired-state path.
  if target.consumption_uom = 'mL'
     and target.units_per_stock_uom = 15::numeric
     and target.note = 'confirmed: 10 mL/procedure; 15 mL/vial'
  then
    continue;
  end if;

  if target.active
     or target.note is distinct from 'seed:heuristic'
     or target.consumption_uom is not null
     or target.units_per_stock_uom is not null
  then
    raise exception 'Hialuronidasa data changed since audit for org %; aborting', target.org_id;
  end if;

  select
      (select count(*) from public.pos_ticket_lines
       where org_id = target.org_id and fin_product_id = target.product_id)
    + (select count(*) from public.sched_event_types
       where org_id = target.org_id and product_id = target.product_id)
    + (select count(*) from public.sched_bookings
       where org_id = target.org_id and product_id = target.product_id)
    + (select count(*) from public.stk_accruals
       where org_id = target.org_id and fin_product_id = target.product_id)
    + (select count(*)
       from public.stk_entries e
       join public.stk_entry_lines l
         on l.org_id = e.org_id and l.entry_id = e.id
       where e.org_id = target.org_id
         and l.item_id = target.item_id
         and coalesce(e.metadata->>'source', '') in ('pos', 'booking', 'service', 'invoice', 'order'))
  into derived_usage;

  if derived_usage <> 0 then
    raise exception 'Hialuronidasa derived usage appeared for org % (% rows); reconcile before updating', target.org_id, derived_usage;
  end if;

  update public.stk_items
  set consumption_uom = 'mL',
      units_per_stock_uom = 15,
      updated_at = clock_timestamp()
  where id = target.item_id
    and org_id = target.org_id
    and consumption_uom is null
    and units_per_stock_uom is null;

  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected one Hialuronidasa item update for org %, got %', target.org_id, changed;
  end if;

  update public.stk_consumption
  set note = 'confirmed: 10 mL/procedure; 15 mL/vial',
      updated_at = clock_timestamp()
  where id = target.consumption_id
    and org_id = target.org_id
    and qty_per_unit = 10;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected one Hialuronidasa mapping update for org %, got %', target.org_id, changed;
  end if;
  end loop;
end $$;
