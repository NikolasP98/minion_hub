-- Master SKU identity + code aliases for the catalog.
--
-- PROBLEM this solves: `code` was doing two incompatible jobs at once — it was
-- both the human-facing short label AND the join key the SUSII invoice sync
-- resolves products through (`loadProductMap`: code -> id). That made a rename
-- silently detach billing history, and made merging a duplicate impossible
-- without `importFromBilling` re-creating it from the old invoice code.
--
-- SPLIT:
--   sku               — the MASTER product identity. Opaque uuid, never shown as
--                       a typing target, never reused. Merges consolidate ONTO a
--                       sku.
--   code              — a short human/import REFERENCE (2-4 chars). Free to
--                       rename now that it is not the only handle.
--   metadata.aliases  — every OTHER code that must still resolve to this row:
--                       retired duplicate codes, and codes from other import
--                       sources. This is what lets SUSII keep sending `RSSVP`
--                       forever after we rename the product.
--
-- Why `sku` and not just the existing `id` PK: `id` is ROW identity and is
-- referenced by 8 tables. `sku` is LOGICAL product identity and can be
-- reassigned — two rows can be given the same sku, or a sku moved onto a
-- survivor — without rewriting a single foreign key. That is exactly the
-- operation a merge needs.
alter table public.fin_products add column if not exists sku uuid not null default gen_random_uuid();
--> statement-breakpoint
-- Not UNIQUE: a merge deliberately points several rows at one surviving sku
-- (the losers stay as inactive, aliased shells so history and FKs survive).
create index if not exists fin_products_org_sku_idx on public.fin_products (org_id, sku);
--> statement-breakpoint

-- Alias lookup. jsonb_path_ops is the smaller/faster GIN opclass and is all the
-- containment probe (`metadata->'aliases' @> '"RSSVP"'`) needs.
create index if not exists fin_products_org_aliases_idx
  on public.fin_products using gin ((metadata -> 'aliases') jsonb_path_ops);
--> statement-breakpoint

-- Stock items get the same master identity: FAJA-S/M/L are three distinct
-- stocked things that must keep their own SKUs while being sold through
-- procedures, and stk_items.code carries the same SUSII-id baggage.
alter table public.stk_items add column if not exists sku uuid not null default gen_random_uuid();
--> statement-breakpoint
create index if not exists stk_items_org_sku_idx on public.stk_items (org_id, sku);
--> statement-breakpoint
alter table public.stk_items add column if not exists metadata jsonb not null default '{}'::jsonb;
--> statement-breakpoint
create index if not exists stk_items_org_aliases_idx
  on public.stk_items using gin ((metadata -> 'aliases') jsonb_path_ops);
