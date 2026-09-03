-- HR roster backfill (spec 2026-09-02-hub-team-hr-module, follow-up to #227/#229).
-- Staff enrolled on the legacy /scheduling/resources page exist as sched_resources
-- rows (kind='staff', profile_id bridge) but never got an hr_employees row, so the
-- /team Roster showed "No employees yet" while Members listed them. Idempotent:
-- one employee per staff resource that has none.
insert into public.hr_employees (org_id, profile_id, resource_id, name, email, status, joined_on)
select r.org_id, r.profile_id, r.id, r.name, r.email, 'active', r.created_at::date
from public.sched_resources r
where r.kind = 'staff'
  and not exists (select 1 from public.hr_employees e where e.resource_id = r.id)
  and (r.profile_id is null or not exists (
        select 1 from public.hr_employees e where e.org_id = r.org_id and e.profile_id = r.profile_id));
