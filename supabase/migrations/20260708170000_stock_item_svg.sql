-- Per-item SVG shape picks for the packaging visuals: unit_svg is the stock-uom
-- container (box/tray/pouch…) drawn by UnitDiagram; subunit_svg is the vessel
-- (bottle/vial/ampoule…) drawn by ConsumptionGauge. Ids resolve against the
-- shape registry in src/lib/components/stock/stock-svg.ts — unknown/null ids
-- fall back to the defaults there, so no CHECK constraint.

alter table public.stk_items
  add column if not exists unit_svg text,
  add column if not exists subunit_svg text;
