-- Warehouse archive (PR-C, spec 2026-08-23-hub-stock-crm-ux-consolidation).
--
-- Soft-delete for stk_warehouses: NULL = active, set = archived. Guarded in
-- stock.service.ts's updateWarehouse (cannot archive the default warehouse,
-- one with non-zero stk_bins stock, or one with non-archived children) — no
-- DB-level constraint needed, same convention as parentId's cycle guard.
alter table public.stk_warehouses add column if not exists archived_at timestamptz;
