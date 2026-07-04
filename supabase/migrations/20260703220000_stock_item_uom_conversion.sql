-- P5.1b: per-item UOM configurability + consumption-unit conversion + gauge flag.
-- An item's stock UOM (uom, e.g. 'caja') can differ from the unit services
-- consume it in (consumption_uom, e.g. 'ml'); units_per_stock_uom converts
-- (1 caja = 500 ml). subunits_per_stock_uom is display-only (10 bottles/caja)
-- for the ConsumptionGauge SVG; diagram_enabled opts the item into the gauge.
-- stk_consumption.qty_per_unit is interpreted in consumption_uom when set.

alter table public.stk_items
  add column if not exists consumption_uom text,
  add column if not exists units_per_stock_uom numeric,
  add column if not exists subunits_per_stock_uom numeric,
  add column if not exists diagram_enabled boolean not null default false;
