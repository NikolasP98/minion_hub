-- Item spine #10 (publish an existing raw material as sellable).
--
-- A fin_product may be backed by AT MOST ONE stk_item. pos.service's
-- resolveIssueLines builds `itemByFinProductId` from a plain select, so two
-- items claiming the same product silently yields an arbitrary winner — and
-- `kind` derivation (item_id != null ? 'product' : 'service') assumes <= 1 too.
-- Until now nothing let a user create that collision; publishing an EXISTING
-- item makes it reachable, so the invariant gets a constraint.
--
-- Pre-flight verified 0 violations before applying (7 linked items -> 7
-- distinct products).
create unique index if not exists stk_items_org_fin_product_uniq
  on public.stk_items (org_id, fin_product_id)
  where fin_product_id is not null;
