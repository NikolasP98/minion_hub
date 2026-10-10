-- Notification Slice5 follow-up (NOTIF-019): evaluate the projection source fence once per statement.
--
-- Migration 20261003170000 installed six app_notification_worker SELECT policies whose using clause
-- calls the VOLATILE public.notification_projection_source_fence(<org column>) for every visited row.
-- Every one of those policies also requires <org column> = current_setting('app.current_org_id'),
-- so for every row the policy can admit the fence argument equals the session organization. The
-- rewrite below passes that session value through an uncorrelated subquery instead, which PostgreSQL
-- plans as one InitPlan + One-Time Filter per scan: the fence runs once per statement and admits
-- exactly the same rows. The argument keeps the uuid-shape guard that the profiles policy already
-- used, so a malformed or empty organization GUC still yields no rows instead of a cast error.
--
-- This migration changes only the using expression of those six policies: no role, ACL, relation,
-- function, trigger or other policy is touched. ALTER POLICY takes ACCESS EXCLUSIVE on each of the
-- six live tables inside one transaction; a timeout aborts the transaction and the previous deploy
-- stays. Like its siblings the migration is non-idempotent by design: a rerun fails the preflight.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

do $$
declare server_major integer:=current_setting('server_version_num')::integer/10000;
begin
  if current_user in ('app_ledger','anon','authenticated','service_role','app_assistant_ro',
    'notification_worker','notification_coordinator','notification_health_reader',
    'notification_event_trigger','app_notification_worker','notification_projection_finalizer') then
    raise exception 'Notification projection fence rewrite requires the trusted backend owner';
  end if;
  if server_major not in (17,18) then
    raise exception 'Notification projection fence rewrite supports PostgreSQL 17 and 18 only';
  end if;
  if server_major=17 and current_user<>'postgres' then
    raise exception 'Notification projection PostgreSQL 17 migration actor changed';
  end if;
  if server_major=17 and (
      (select rolsuper or not rolcanlogin from pg_roles where rolname=current_user)
      or not has_schema_privilege(current_user,'auth','USAGE')
      or has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION')
      or pg_has_role(current_user,(select nspowner from pg_namespace where nspname='auth'),'USAGE'))
  then
    raise exception 'Notification projection PostgreSQL 17 auth actor boundary changed';
  end if;
  if to_regrole('app_notification_worker') is null
    or to_regprocedure('public.notification_projection_source_fence(uuid)') is null
    or not exists(select 1 from pg_proc where oid='public.notification_projection_source_fence(uuid)'::regprocedure
      and provolatile='v' and prosecdef=false and prorettype='boolean'::regtype) then
    raise exception 'Notification projection fence predecessor is unavailable';
  end if;
  if exists(select 1 from pg_class c where c.oid=any(array[
      'public.organizations'::regclass,'public.organization_members'::regclass,
      'public.profiles'::regclass,'public.member_roles'::regclass,
      'public.permission_rules'::regclass,'public.join_request'::regclass])
      and (pg_get_userbyid(c.relowner)<>current_user or not c.relrowsecurity)) then
    raise exception 'Notification projection source relation catalog changed';
  end if;

  -- Freeze every policy on the six source relations. The postflight proves that only the six
  -- reviewed using expressions changed and that each of them still carried the exact text
  -- migration 20261003170000 installed.
  create temporary table notification_projection_fence_policy_before on commit drop as
  select c.relname,p.polname,p.polcmd,p.polpermissive,
    array(select case when role_oid=0 then 'PUBLIC' else pg_get_userbyid(role_oid) end
      from unnest(p.polroles) role_oid order by 1) as roles,
    pg_get_expr(p.polqual,p.polrelid,true) as qual,
    pg_get_expr(p.polwithcheck,p.polrelid,true) as with_check
  from pg_policy p join pg_class c on c.oid=p.polrelid
  where p.polrelid=any(array[
    'public.organizations'::regclass,'public.organization_members'::regclass,
    'public.profiles'::regclass,'public.member_roles'::regclass,
    'public.permission_rules'::regclass,'public.join_request'::regclass]);
  create temporary table notification_projection_fence_expected_before (
    relname text not null,polname text not null,polcmd "char" not null,polpermissive boolean not null,
    roles text[] not null,qual text,with_check text,primary key(relname,polname)
  ) on commit drop;
  insert into notification_projection_fence_expected_before values
    ('join_request','notification_projection_join_request_select','r',true,
      array['app_notification_worker']::text[],$worker$organization_id = current_setting('app.current_org_id'::text, true) AND organization_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text AND notification_projection_source_fence(organization_id::uuid) AND (EXISTS ( SELECT 1
   FROM notification_events e
  WHERE e.organization_id::text = join_request.organization_id AND e.subject_type = 'join_request'::text AND e.subject_id = join_request.id))$worker$,null),
    ('member_roles','notification_projection_member_roles_select','r',true,
      array['app_notification_worker']::text[],$worker$org_id::text = current_setting('app.current_org_id'::text, true) AND notification_projection_source_fence(org_id)$worker$,null),
    ('organization_members','notification_projection_organization_members_select','r',true,
      array['app_notification_worker']::text[],$worker$organization_id::text = current_setting('app.current_org_id'::text, true) AND notification_projection_source_fence(organization_id)$worker$,null),
    ('organizations','notification_projection_organizations_select','r',true,
      array['app_notification_worker']::text[],$worker$id::text = current_setting('app.current_org_id'::text, true) AND notification_projection_source_fence(id)$worker$,null),
    ('permission_rules','notification_projection_permission_rules_select','r',true,
      array['app_notification_worker']::text[],$worker$org_id::text = current_setting('app.current_org_id'::text, true) AND module = 'users'::text AND notification_projection_source_fence(org_id)$worker$,null),
    ('profiles','notification_projection_profiles_select','r',true,
      array['app_notification_worker']::text[],$worker$notification_projection_source_fence(
CASE
    WHEN current_setting('app.current_org_id'::text, true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN current_setting('app.current_org_id'::text, true)::uuid
    ELSE NULL::uuid
END) AND ((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE m.organization_id::text = current_setting('app.current_org_id'::text, true) AND m.profile_id = profiles.id)) OR (EXISTS ( SELECT 1
   FROM join_request j
     JOIN notification_events e ON e.organization_id::text = j.organization_id AND e.subject_type = 'join_request'::text AND e.subject_id = j.id
  WHERE j.organization_id = current_setting('app.current_org_id'::text, true) AND j.supabase_id = profiles.id AND j.user_id = j.supabase_id::text)))$worker$,null);
  if exists((select * from notification_projection_fence_policy_before
        where polname like 'notification_projection_%_select')
      except (select * from notification_projection_fence_expected_before))
    or exists((select * from notification_projection_fence_expected_before)
      except (select * from notification_projection_fence_policy_before
        where polname like 'notification_projection_%_select')) then
    raise exception 'Notification projection fence policy catalog changed';
  end if;
end $$;

-- Projection setup must prove the cleared JWT resolves to no identity. PostgreSQL 17 production
-- exposes auth.uid() for execution but does not grant the worker schema resolution. Freeze every
-- adjacent authority surface while preserving the existing no-worker-schema-usage boundary.
create temporary table notification_projection_auth_functions_expected (
  function text primary key,owner text not null,security_definer boolean not null
) on commit drop;
insert into notification_projection_auth_functions_expected values
  ('auth.email()','supabase_auth_admin',false),
  ('auth.jwt()','supabase_auth_admin',false),
  ('auth.role()','supabase_auth_admin',false),
  ('auth.uid()','supabase_auth_admin',false);
create temporary table notification_projection_auth_functions_before on commit drop as
select p.oid::regprocedure::text as function,pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer
from pg_proc p where p.pronamespace='auth'::regnamespace
  and has_function_privilege('app_notification_worker',p.oid,'EXECUTE') order by 1;
create temporary table notification_projection_auth_acl_expected (
  function text not null,grantee text not null,grantor text not null,
  privilege_type text not null,is_grantable boolean not null,
  primary key(function,grantee,grantor,privilege_type)
) on commit drop;
insert into notification_projection_auth_acl_expected
select function,grantee,'supabase_auth_admin','EXECUTE',false
from (values
  ('auth.email()','PUBLIC'),('auth.email()','supabase_auth_admin'),('auth.email()','dashboard_user'),
  ('auth.jwt()','PUBLIC'),('auth.jwt()','supabase_auth_admin'),('auth.jwt()','dashboard_user'),
  ('auth.jwt()','postgres'),
  ('auth.role()','PUBLIC'),('auth.role()','supabase_auth_admin'),('auth.role()','dashboard_user'),
  ('auth.uid()','PUBLIC'),('auth.uid()','supabase_auth_admin'),('auth.uid()','dashboard_user')
) expected(function,grantee);
create temporary table notification_projection_auth_acl_before on commit drop as
select p.oid::regprocedure::text as function,
  case acl.grantee when 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor,acl.privilege_type,acl.is_grantable
from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
where p.oid::regprocedure::text in (select function from notification_projection_auth_functions_expected);
create temporary table notification_projection_auth_relations_before on commit drop as
select c.oid::regclass::text as relation,
  has_table_privilege('app_notification_worker',c.oid,'SELECT') as can_select,
  has_table_privilege('app_notification_worker',c.oid,'INSERT') as can_insert,
  has_table_privilege('app_notification_worker',c.oid,'UPDATE') as can_update,
  has_table_privilege('app_notification_worker',c.oid,'DELETE') as can_delete
from pg_class c where c.relnamespace='auth'::regnamespace and c.relkind in ('r','p','v','m');
create temporary table notification_projection_worker_role_before on commit drop as
select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,
  rolbypassrls,rolconnlimit,rolvaliduntil
from pg_roles where oid='app_notification_worker'::regrole;
create temporary table notification_projection_worker_memberships_before on commit drop as
select roleid,member,grantor,admin_option,inherit_option,set_option
from pg_auth_members where member='app_notification_worker'::regrole
  or roleid='app_notification_worker'::regrole;
do $$ begin
  if has_schema_privilege('app_notification_worker','auth','USAGE')
    or exists((select * from notification_projection_auth_functions_before)
      except (select * from notification_projection_auth_functions_expected))
    or exists((select * from notification_projection_auth_functions_expected)
      except (select * from notification_projection_auth_functions_before))
    or exists((select * from notification_projection_auth_acl_before)
      except (select * from notification_projection_auth_acl_expected))
    or exists((select * from notification_projection_auth_acl_expected)
      except (select * from notification_projection_auth_acl_before))
    or exists(select 1 from notification_projection_auth_relations_before
      where can_select or can_insert or can_update or can_delete) then
    raise exception 'Notification projection auth boundary changed';
  end if;
end $$;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
do $$ begin
  if auth.uid() is not null then
    raise exception 'Notification projection cleared JWT identity changed';
  end if;
end $$;
set local role app_notification_worker;
do $$ begin
  if current_setting('request.jwt.claim.sub',true)<>''
    or current_setting('request.jwt.claims',true)<>'{}' then
    raise exception 'Notification projection worker JWT scope changed';
  end if;
end $$;
reset role;

-- One uncorrelated fence per policy. The remaining conjuncts are byte-for-byte what 20261003170000
-- installed, so the admitted row set is unchanged: every admitted row satisfies
-- <org column> = current_setting('app.current_org_id'), hence fence(<org column>) = fence(session org).
alter policy notification_projection_organizations_select on public.organizations
  using(id::text=current_setting('app.current_org_id',true)
    and (select public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)));

alter policy notification_projection_organization_members_select on public.organization_members
  using(organization_id::text=current_setting('app.current_org_id',true)
    and (select public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)));

alter policy notification_projection_member_roles_select on public.member_roles
  using(org_id::text=current_setting('app.current_org_id',true)
    and (select public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)));

alter policy notification_projection_permission_rules_select on public.permission_rules
  using(org_id::text=current_setting('app.current_org_id',true) and module='users'
    and (select public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)));

alter policy notification_projection_join_request_select on public.join_request
  using(join_request.organization_id=current_setting('app.current_org_id',true)
    and join_request.organization_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end))
    and exists(select 1 from public.notification_events e
      where e.organization_id::text=join_request.organization_id and e.subject_type='join_request'
        and e.subject_id=join_request.id));

alter policy notification_projection_profiles_select on public.profiles
  using((select public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end))
    and (
      exists(select 1 from public.organization_members m
        where m.organization_id::text=current_setting('app.current_org_id',true) and m.profile_id=profiles.id)
      or exists(select 1 from public.join_request j join public.notification_events e
          on e.organization_id::text=j.organization_id and e.subject_type='join_request' and e.subject_id=j.id
        where j.organization_id=current_setting('app.current_org_id',true)
          and j.supabase_id=profiles.id and j.user_id=j.supabase_id::text)
    ));

-- Postflight: the six policies carry exactly the reviewed expressions, nothing else about them
-- (roles, permissive, command, with_check) changed, and no other policy on the six relations moved.
do $$
begin
  if has_schema_privilege('app_notification_worker','auth','USAGE')
    or has_schema_privilege('app_notification_worker','auth','CREATE')
    or exists((select * from notification_projection_auth_functions_before)
      except (select p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.prosecdef
        from pg_proc p where p.pronamespace='auth'::regnamespace
          and has_function_privilege('app_notification_worker',p.oid,'EXECUTE')))
    or exists((select p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.prosecdef
        from pg_proc p where p.pronamespace='auth'::regnamespace
          and has_function_privilege('app_notification_worker',p.oid,'EXECUTE'))
      except (select * from notification_projection_auth_functions_before))
    or exists((select * from notification_projection_auth_acl_before)
      except (select p.oid::regprocedure::text,
        case acl.grantee when 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
        pg_get_userbyid(acl.grantor),acl.privilege_type,acl.is_grantable
        from pg_proc p cross join lateral
          aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid::regprocedure::text in
          (select function from notification_projection_auth_functions_expected)))
    or exists((select p.oid::regprocedure::text,
        case acl.grantee when 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
        pg_get_userbyid(acl.grantor),acl.privilege_type,acl.is_grantable
        from pg_proc p cross join lateral
          aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid::regprocedure::text in
          (select function from notification_projection_auth_functions_expected))
      except (select * from notification_projection_auth_acl_before))
    or exists(select 1 from pg_class c where c.relnamespace='auth'::regnamespace
      and c.relkind in ('r','p','v','m') and (
        has_table_privilege('app_notification_worker',c.oid,'SELECT') or
        has_table_privilege('app_notification_worker',c.oid,'INSERT') or
        has_table_privilege('app_notification_worker',c.oid,'UPDATE') or
        has_table_privilege('app_notification_worker',c.oid,'DELETE')))
    or exists((select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
        rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil
        from pg_roles where oid='app_notification_worker'::regrole)
      except (select * from notification_projection_worker_role_before))
    or exists((select * from notification_projection_worker_role_before)
      except (select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
        rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil
        from pg_roles where oid='app_notification_worker'::regrole))
    or exists((select roleid,member,grantor,admin_option,inherit_option,set_option
        from pg_auth_members where member='app_notification_worker'::regrole
          or roleid='app_notification_worker'::regrole)
      except (select * from notification_projection_worker_memberships_before))
    or exists((select * from notification_projection_worker_memberships_before)
      except (select roleid,member,grantor,admin_option,inherit_option,set_option
        from pg_auth_members where member='app_notification_worker'::regrole
          or roleid='app_notification_worker'::regrole))
    or exists(select 1 from notification_projection_auth_relations_before
      where can_select or can_insert or can_update or can_delete)
    or exists(select 1 from notification_projection_worker_memberships_before
      where member='app_notification_worker'::regrole)
    then
    raise exception 'Notification projection auth postflight changed';
  end if;
  create temporary table notification_projection_fence_policy_after on commit drop as
  select c.relname,p.polname,p.polcmd,p.polpermissive,
    array(select case when role_oid=0 then 'PUBLIC' else pg_get_userbyid(role_oid) end
      from unnest(p.polroles) role_oid order by 1) as roles,
    pg_get_expr(p.polqual,p.polrelid,true) as qual,
    pg_get_expr(p.polwithcheck,p.polrelid,true) as with_check
  from pg_policy p join pg_class c on c.oid=p.polrelid
  where p.polrelid=any(array[
    'public.organizations'::regclass,'public.organization_members'::regclass,
    'public.profiles'::regclass,'public.member_roles'::regclass,
    'public.permission_rules'::regclass,'public.join_request'::regclass]);
  create temporary table notification_projection_fence_expected_after
    (like notification_projection_fence_expected_before including all) on commit drop;
  insert into notification_projection_fence_expected_after values
    ('join_request','notification_projection_join_request_select','r',true,
      array['app_notification_worker']::text[],$worker$organization_id = current_setting('app.current_org_id'::text, true) AND organization_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text AND ( SELECT notification_projection_source_fence(
        CASE
            WHEN current_setting('app.current_org_id'::text, true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN current_setting('app.current_org_id'::text, true)::uuid
            ELSE NULL::uuid
        END) AS notification_projection_source_fence) AND (EXISTS ( SELECT 1
   FROM notification_events e
  WHERE e.organization_id::text = join_request.organization_id AND e.subject_type = 'join_request'::text AND e.subject_id = join_request.id))$worker$,null),
    ('member_roles','notification_projection_member_roles_select','r',true,
      array['app_notification_worker']::text[],$worker$org_id::text = current_setting('app.current_org_id'::text, true) AND ( SELECT notification_projection_source_fence(
        CASE
            WHEN current_setting('app.current_org_id'::text, true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN current_setting('app.current_org_id'::text, true)::uuid
            ELSE NULL::uuid
        END) AS notification_projection_source_fence)$worker$,null),
    ('organization_members','notification_projection_organization_members_select','r',true,
      array['app_notification_worker']::text[],$worker$organization_id::text = current_setting('app.current_org_id'::text, true) AND ( SELECT notification_projection_source_fence(
        CASE
            WHEN current_setting('app.current_org_id'::text, true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN current_setting('app.current_org_id'::text, true)::uuid
            ELSE NULL::uuid
        END) AS notification_projection_source_fence)$worker$,null),
    ('organizations','notification_projection_organizations_select','r',true,
      array['app_notification_worker']::text[],$worker$id::text = current_setting('app.current_org_id'::text, true) AND ( SELECT notification_projection_source_fence(
        CASE
            WHEN current_setting('app.current_org_id'::text, true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN current_setting('app.current_org_id'::text, true)::uuid
            ELSE NULL::uuid
        END) AS notification_projection_source_fence)$worker$,null),
    ('permission_rules','notification_projection_permission_rules_select','r',true,
      array['app_notification_worker']::text[],$worker$org_id::text = current_setting('app.current_org_id'::text, true) AND module = 'users'::text AND ( SELECT notification_projection_source_fence(
        CASE
            WHEN current_setting('app.current_org_id'::text, true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN current_setting('app.current_org_id'::text, true)::uuid
            ELSE NULL::uuid
        END) AS notification_projection_source_fence)$worker$,null),
    ('profiles','notification_projection_profiles_select','r',true,
      array['app_notification_worker']::text[],$worker$( SELECT notification_projection_source_fence(
        CASE
            WHEN current_setting('app.current_org_id'::text, true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN current_setting('app.current_org_id'::text, true)::uuid
            ELSE NULL::uuid
        END) AS notification_projection_source_fence) AND ((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE m.organization_id::text = current_setting('app.current_org_id'::text, true) AND m.profile_id = profiles.id)) OR (EXISTS ( SELECT 1
   FROM join_request j
     JOIN notification_events e ON e.organization_id::text = j.organization_id AND e.subject_type = 'join_request'::text AND e.subject_id = j.id
  WHERE j.organization_id = current_setting('app.current_org_id'::text, true) AND j.supabase_id = profiles.id AND j.user_id = j.supabase_id::text)))$worker$,null);
  if exists((select * from notification_projection_fence_policy_after
        where polname like 'notification_projection_%_select')
      except (select * from notification_projection_fence_expected_after))
    or exists((select * from notification_projection_fence_expected_after)
      except (select * from notification_projection_fence_policy_after
        where polname like 'notification_projection_%_select')) then
    raise exception 'Notification projection fence policy installation changed';
  end if;
  if exists((select * from notification_projection_fence_policy_before
        where polname not like 'notification_projection_%_select')
      except (select * from notification_projection_fence_policy_after
        where polname not like 'notification_projection_%_select'))
    or exists((select * from notification_projection_fence_policy_after
        where polname not like 'notification_projection_%_select')
      except (select * from notification_projection_fence_policy_before
        where polname not like 'notification_projection_%_select')) then
    raise exception 'Notification projection fence rewrite changed an unrelated policy';
  end if;
  if (select count(*) from notification_projection_fence_policy_after)
      <>(select count(*) from notification_projection_fence_policy_before)
    or (select count(*) from pg_policy p
      where p.polrelid=any(array[
        'public.organizations'::regclass,'public.organization_members'::regclass,
        'public.profiles'::regclass,'public.member_roles'::regclass,
        'public.permission_rules'::regclass,'public.join_request'::regclass])
        and p.polname like 'notification_projection_%_select'
        and p.polroles=array['app_notification_worker'::regrole::oid]
        and p.polpermissive and p.polcmd='r' and p.polwithcheck is null
        and pg_get_expr(p.polqual,p.polrelid,true) like '%( SELECT notification_projection_source_fence(%'
        and pg_get_expr(p.polqual,p.polrelid,true) not like '%AND notification_projection_source_fence(%'
        and pg_get_expr(p.polqual,p.polrelid,true) not like 'notification_projection_source_fence(%')<>6 then
    raise exception 'Notification projection fence policy installation is incomplete';
  end if;
end $$;
