-- Stock supply side (item spine #12).
--
-- The stock module owns raw materials AND their procurement facts: "how much it
-- cost to restock them, who are the contacts (parties) which these items are
-- bought from, how much it costs, MOQ".
--
-- moq                       — minimum order quantity, in the item's stock uom.
-- default_supplier_party_id — soft ref -> parties (same cross-module convention
--   as stk_items.fin_product_id; no FK). NOTE stk_entries.party_id is the
--   supplier on a specific RECEIPT — this is the item's standing default.
--
-- Last restock COST is deliberately NOT a column: it is derivable exactly from
-- stk_ledger (value_delta / qty_delta of the most recent positive movement), so
-- storing it would just be a denormalised copy that can drift.
alter table public.stk_items
  add column if not exists moq numeric,
  add column if not exists default_supplier_party_id uuid;
--> statement-breakpoint
create index if not exists stk_items_org_supplier_idx
  on public.stk_items (org_id, default_supplier_party_id)
  where default_supplier_party_id is not null;
