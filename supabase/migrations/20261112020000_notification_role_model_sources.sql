-- Organization role catalogs become an authority source for notification recipients.
-- Existing source fences and column-only worker privileges remain mandatory.
do $$
begin
  if to_regrole('app_notification_worker') is null then
    raise exception 'Notification projection worker must exist before role-model source migration';
  end if;
  if to_regprocedure('public.notification_projection_source_fence(uuid)') is null then
    raise exception 'Notification projection source fence must be installed first';
  end if;
  if not exists(select 1 from pg_class where oid='public.org_roles'::regclass
      and relrowsecurity and relforcerowsecurity and pg_get_userbyid(relowner)=current_user) then
    raise exception 'Organization role source must retain its reviewed owner and forced RLS';
  end if;
  if has_table_privilege('app_notification_worker','public.org_roles','SELECT') then
    raise exception 'Notification worker must not have broad role catalog SELECT';
  end if;

end $$;
-- Keep the source worker restricted to the three additional values actually read.
grant select(role_model) on public.organizations to app_notification_worker;
grant select(org_id,key) on public.org_roles to app_notification_worker;
-- The historical org_roles GUC policy is PUBLIC and permissive. A restrictive
-- policy ANDs the live immutable-event/receipt fence with it for this worker only.
create policy notification_projection_org_roles_fence on public.org_roles
  as restrictive for select to app_notification_worker
  using(org_id=current_setting('app.current_org_id',true)
    and (select public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)));
