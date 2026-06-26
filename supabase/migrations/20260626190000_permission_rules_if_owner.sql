-- Phase 3 (record-level / if-owner): per (org, role, module) flag restricting a
-- role to records it owns (owner_id = current profile). Additive + default false
-- so existing rows keep full-org visibility; enforcement is opt-in per role×module.
-- Applied to prod gxv via MCP 2026-06-26.
alter table public.permission_rules
  add column if not exists if_owner boolean not null default false;
