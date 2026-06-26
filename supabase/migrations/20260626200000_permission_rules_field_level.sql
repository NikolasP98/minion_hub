-- Phase 4 (field-level / ERPNext permission levels): per (org, role, module) the
-- max sensitivity tier the role may read. 0 = base fields only; >=1 = sensitive
-- (PII, cost/margin). Additive + default 0; the code default lifts owner/admin/
-- manager to 1 for modules with a sensitive tier so nobody loses current access.
-- Applied to prod gxv via MCP 2026-06-26.
alter table public.permission_rules
  add column if not exists field_level smallint not null default 0;
