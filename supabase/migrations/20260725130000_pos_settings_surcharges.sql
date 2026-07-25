-- Payment-method surcharges as POS CONFIG, not a catalog product.
--
-- "Ajuste por Método de Pago" (code AJ) was modelled as a sellable product, so a
-- card fee had to be rung up as a line item and then polluted every
-- product-level report as if it were a treatment. It becomes settings:
--   { "card": { "type": "percent"|"fixed", "amount": 3.5, "label": "…" } }
-- keyed by payment method, so the POS can apply it automatically at tender time.
--
-- The AJ product row is retired (inactive + aliased), NOT deleted — its 8
-- historical invoice lines must keep resolving.
alter table public.pos_settings
  add column if not exists surcharges jsonb not null default '{}'::jsonb;
