-- Item archive (spec 2026-09-28-hub-table-open-modes-bulk-bar-stock-detail,
-- Bundle C #5). Soft-delete for stk_items, same convention as
-- 20260823120000_stk_warehouses_archived.sql: NULL = active, set = archived.
-- Guarded in stock.service.ts's archiveItems (no DB-level constraint needed —
-- an archived item may still carry stock; it stays visible in ledgers).
alter table public.stk_items add column if not exists archived_at timestamptz;
--> statement-breakpoint
create index if not exists idx_stk_items_org_active on public.stk_items (org_id) where archived_at is null;
