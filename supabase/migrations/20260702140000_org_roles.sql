-- P3-W2 org-scoped custom roles — ADDITIVE side-table design (no PK surgery on
-- the global `permission_roles` catalog). See specs/hub-erp-roadmap/P3-role-aware-ui.md.
--
-- Recon (2026-07-02): both `member_roles.role_key` and `permission_rules.role_key`
-- carry an FK to `permission_roles.key` (member_roles_role_key_fkey,
-- permission_rules_role_key_fkey). Custom role keys (`custom-<slug>`) are
-- org-scoped and are intentionally never inserted into the global catalog, so
-- those FKs would reject every row that references a custom role. Drop them —
-- app-level validation replaces them: `isAssignableRoleKey` (rbac.service)
-- checks system keys via SYSTEM_ROLE_KEYS and custom keys via `org_roles`;
-- `createCustomRole`/`deleteCustomRole` own the org_roles lifecycle so a
-- referenced role can't be deleted out from under member_roles.
alter table public.member_roles drop constraint if exists member_roles_role_key_fkey;
alter table public.permission_rules drop constraint if exists permission_rules_role_key_fkey;

create table if not exists public.org_roles (
  org_id text not null,
  key text not null,
  name text not null,
  rank int not null,
  source_role_key text,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (org_id, key)
);

create index if not exists org_roles_org_idx on public.org_roles (org_id);

-- ── RLS (org_guc — role app_ledger + app.current_org_id GUC) ────────────────
-- Same shape as brains_org_guc / parties_org_guc (20260702120000_brains.sql).

alter table public.org_roles enable row level security;
alter table public.org_roles force row level security;
drop policy if exists org_roles_org_guc on public.org_roles;
create policy org_roles_org_guc on public.org_roles
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- app_ledger is the non-bypass role withOrgCore SET LOCAL ROLEs into inside the
-- txn (see with-org-core.ts) — needs explicit table grants, same as `brains`.
grant select, insert, update, delete on public.org_roles to app_ledger;

comment on table public.org_roles is
  'Org-scoped custom roles (P3-W2). Additive beside the global permission_roles catalog — a custom role key (custom-<slug>) is never inserted into permission_roles; its permission_rules rows are org_id+role_key scoped like any override.';
