-- Let the forced-RLS app_ledger role read organization departments while a
-- Hub corpus transaction has set app.current_org_id. Existing member-read RLS
-- remains intact; this policy only opens the exact current org to the role.
grant select on table public.org_areas to app_ledger;

drop policy if exists org_areas_org_guc on public.org_areas;
create policy org_areas_org_guc on public.org_areas
  for select to app_ledger
  using (
    organization_id::text = current_setting('app.current_org_id', true)
  );

-- The org-chart corpus also needs the canonical local membership/role spine.
-- These are read-only grants; profile details are not selected and the corpus
-- query can only see rows for app.current_org_id.
grant select on table public.organization_members to app_ledger;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
drop policy if exists organization_members_org_guc on public.organization_members;
create policy organization_members_org_guc on public.organization_members
  for select to app_ledger
  using (
    organization_id::text = current_setting('app.current_org_id', true)
  );

grant select on table public.member_roles to app_ledger;
alter table public.member_roles enable row level security;
alter table public.member_roles force row level security;
drop policy if exists member_roles_org_guc on public.member_roles;
create policy member_roles_org_guc on public.member_roles
  for select to app_ledger
  using (
    org_id = current_setting('app.current_org_id', true)
  );
