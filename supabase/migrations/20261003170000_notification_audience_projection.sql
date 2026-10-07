-- Notification Slice5: exact-tuple audience projection under current authority.
-- This migration creates no producer, inbox route, browser read path, or provider effect.

-- The policy/ACL rewrites below take ACCESS EXCLUSIVE on six live tables inside one transaction
-- during the build; a timeout aborts the transaction, the build fails and the previous deploy stays.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

do $$
declare role_name text; policy_count integer; temporary_graph_count integer; app_graph_count integer;
  server_major integer:=current_setting('server_version_num')::integer/10000;
begin
  if current_user in ('app_ledger','anon','authenticated','service_role','app_assistant_ro',
    'notification_worker','notification_coordinator','notification_health_reader','notification_event_trigger') then
    raise exception 'Notification projection requires the trusted backend owner';
  end if;
  if to_regclass('public.notification_events') is null
    or to_regclass('public.notification_outbox') is null
    or to_regclass('public.notification_worker_runtime') is null
    or to_regclass('public.notification_org_control') is null then
    raise exception 'Notification projection predecessor is unavailable';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.notification_outbox'::regclass
      and tgname='notification_outbox_transition' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgrelid='public.notification_events'::regclass
      and tgname='notification_event_outbox' and not tgisinternal) then
    raise exception 'Notification projection predecessor trigger is unavailable';
  end if;

  -- Freeze and admit the complete pre-Slice5 source catalog before any role,
  -- policy, ACL, function or relation mutation. The postflight reuses these
  -- rows to prove that retargeting changed only the reviewed role arrays.
  create temporary table notification_projection_source_relation_before on commit drop as
  select c.relname,pg_get_userbyid(c.relowner) as owner_name,c.relrowsecurity,c.relforcerowsecurity
  from pg_class c where c.oid=any(array[
    'public.organizations'::regclass,'public.organization_members'::regclass,
    'public.profiles'::regclass,'public.member_roles'::regclass,
    'public.permission_rules'::regclass,'public.join_request'::regclass]);
  if (select count(*) from notification_projection_source_relation_before)<>6
    or exists(select 1 from notification_projection_source_relation_before
      where owner_name<>current_user
        or (relname in ('member_roles','organization_members','permission_rules') and
          (not relrowsecurity or not relforcerowsecurity))
        or (relname in ('join_request','organizations','profiles') and
          (not relrowsecurity or relforcerowsecurity))) then
    raise exception 'Notification projection source relation catalog changed';
  end if;

  create temporary table notification_projection_source_table_acl_before on commit drop as
  select c.relname,
    case when acl.grantee=0 then 'PUBLIC'
      when acl.grantee=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantee) end as grantee,
    case when acl.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantor) end as grantor,
    acl.privilege_type,acl.is_grantable
  from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  where c.oid=any(array[
    'public.organizations'::regclass,'public.organization_members'::regclass,
    'public.profiles'::regclass,'public.member_roles'::regclass,
    'public.permission_rules'::regclass,'public.join_request'::regclass]);
  create temporary table notification_projection_expected_source_table_acl (
    relname text not null,grantee text not null,grantor text not null,
    privilege_type text not null,is_grantable boolean not null,
    primary key(relname,grantee,privilege_type)
  ) on commit drop;
  insert into notification_projection_expected_source_table_acl
  select relation_name,expected_role,'RELATION_OWNER',privilege,false
  from unnest(array['organizations','organization_members','profiles','member_roles',
      'permission_rules','join_request']) relation_name
  cross join unnest(array['RELATION_OWNER','anon','authenticated','service_role']) expected_role
  cross join unnest(array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) privilege;
  insert into notification_projection_expected_source_table_acl values
    ('member_roles','app_ledger','RELATION_OWNER','DELETE',false),
    ('member_roles','app_ledger','RELATION_OWNER','INSERT',false),
    ('member_roles','app_ledger','RELATION_OWNER','SELECT',false),
    ('member_roles','app_ledger','RELATION_OWNER','UPDATE',false),
    ('organization_members','app_ledger','RELATION_OWNER','SELECT',false),
    ('permission_rules','app_ledger','RELATION_OWNER','DELETE',false),
    ('permission_rules','app_ledger','RELATION_OWNER','INSERT',false),
    ('permission_rules','app_ledger','RELATION_OWNER','SELECT',false),
    ('permission_rules','app_ledger','RELATION_OWNER','UPDATE',false),
    ('profiles','app_ledger','RELATION_OWNER','SELECT',false);
  if exists((select * from notification_projection_source_table_acl_before)
      except (select * from notification_projection_expected_source_table_acl))
    or exists((select * from notification_projection_expected_source_table_acl)
      except (select * from notification_projection_source_table_acl_before)) then
    raise exception 'Notification projection source table ACL catalog changed';
  end if;
  if exists(
    select 1 from pg_class c join pg_attribute attribute on attribute.attrelid=c.oid
    cross join lateral aclexplode(attribute.attacl) acl
    where c.oid=any(array[
      'public.organizations'::regclass,'public.organization_members'::regclass,
      'public.profiles'::regclass,'public.member_roles'::regclass,
      'public.permission_rules'::regclass,'public.join_request'::regclass])
      and attribute.attnum>0 and not attribute.attisdropped
  ) then raise exception 'Notification projection source column ACL catalog changed'; end if;

  create temporary table notification_projection_source_policy_before on commit drop as
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
  create temporary table notification_projection_expected_source_policy_before (
    relname text not null,polname text not null,polcmd "char" not null,polpermissive boolean not null,
    roles text[] not null,qual text,with_check text,primary key(relname,polname)
  ) on commit drop;
  insert into notification_projection_expected_source_policy_before values
    ('join_request','join_request_admin_all','*',true,array['PUBLIC']::text[],$policy$(EXISTS ( SELECT 1
   FROM profiles p
  WHERE p.id = (( SELECT auth.uid() AS uid)) AND p.role = 'admin'::text))$policy$,null),
    ('join_request','join_request_self_insert','a',true,array['PUBLIC']::text[],null,$policy$(( SELECT auth.uid() AS uid)) = supabase_id$policy$),
    ('join_request','join_request_self_select','r',true,array['PUBLIC']::text[],$policy$(( SELECT auth.uid() AS uid)) = supabase_id$policy$,null),
    ('member_roles','member_roles_org_guc','r',true,array['app_ledger']::text[],$policy$org_id::text = current_setting('app.current_org_id'::text, true)$policy$,null),
    ('organization_members','organization_members_admin_all','*',true,array['PUBLIC']::text[],$policy$(EXISTS ( SELECT 1
   FROM profiles p
  WHERE p.id = (( SELECT auth.uid() AS uid)) AND p.role = 'admin'::text))$policy$,null),
    ('organization_members','organization_members_org_guc','r',true,array['app_ledger']::text[],$policy$organization_id::text = current_setting('app.current_org_id'::text, true)$policy$,null),
    ('organization_members','organization_members_self_select','r',true,array['PUBLIC']::text[],$policy$profile_id = (( SELECT auth.uid() AS uid))$policy$,null),
    ('organizations','organizations_admin_all','*',true,array['PUBLIC']::text[],$policy$(EXISTS ( SELECT 1
   FROM profiles p
  WHERE p.id = (( SELECT auth.uid() AS uid)) AND p.role = 'admin'::text))$policy$,null),
    ('organizations','organizations_member_select','r',true,array['PUBLIC']::text[],$policy$(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE m.organization_id = organizations.id AND m.profile_id = (( SELECT auth.uid() AS uid))))$policy$,null),
    ('permission_rules','permission_rules_org_guc','*',true,array['PUBLIC']::text[],$policy$org_id::text = current_setting('app.current_org_id'::text, true)$policy$,$policy$org_id::text = current_setting('app.current_org_id'::text, true)$policy$),
    ('profiles','profiles_self_select','r',true,array['PUBLIC']::text[],$policy$(( SELECT auth.uid() AS uid)) = id$policy$,null),
    ('profiles','profiles_self_update','w',true,array['PUBLIC']::text[],$policy$(( SELECT auth.uid() AS uid)) = id$policy$,null);
  if exists((select * from notification_projection_source_policy_before)
      except (select * from notification_projection_expected_source_policy_before))
    or exists((select * from notification_projection_expected_source_policy_before)
      except (select * from notification_projection_source_policy_before)) then
    raise exception 'Notification projection source policy catalog changed';
  end if;
  create temporary table notification_projection_expected_source_policy_after
    (like notification_projection_expected_source_policy_before including all) on commit drop;
  insert into notification_projection_expected_source_policy_after
  select relname,polname,polcmd,polpermissive,
    case
      when polname in ('organization_members_admin_all','organization_members_self_select',
          'profiles_self_select','permission_rules_org_guc') then
        array(select distinct expected_role from unnest(array[
          'anon','authenticated','service_role','app_ledger',current_user]) expected_role order by 1)
      when polname in ('member_roles_org_guc','organization_members_org_guc') then
        array['app_ledger']::text[]
      else array(select distinct expected_role from unnest(array[
        'anon','authenticated','service_role',current_user]) expected_role order by 1)
    end,
    qual,with_check
  from notification_projection_source_policy_before;
  insert into notification_projection_expected_source_policy_after values
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

  create temporary table notification_projection_source_edges_before on commit drop as
  select target.rolname as target,member.rolname as member,grantor.rolname as grantor,
    membership.admin_option,membership.inherit_option,membership.set_option
  from pg_auth_members membership
  join pg_roles target on target.oid=membership.roleid
  join pg_roles member on member.oid=membership.member
  join pg_roles grantor on grantor.oid=membership.grantor
  where target.rolname=any(array['anon','authenticated','service_role','app_ledger',current_user]);
  create temporary table notification_projection_expected_source_edges (
    target text not null,member text not null,grantor text not null,
    admin_option boolean not null,inherit_option boolean not null,set_option boolean not null,
    primary key(target,member,grantor)
  ) on commit drop;
  if server_major=17 then
    if current_user<>'postgres' then
      raise exception 'Notification projection PostgreSQL 17 migration actor changed';
    end if;
    insert into notification_projection_expected_source_edges values
      ('anon','authenticator','supabase_admin',false,false,true),
      ('anon','postgres','supabase_admin',true,true,true),
      ('app_ledger','postgres','postgres',false,true,true),
      ('app_ledger','postgres','supabase_admin',true,false,false),
      ('authenticated','authenticator','supabase_admin',false,false,true),
      ('authenticated','postgres','supabase_admin',true,true,true),
      ('service_role','authenticator','supabase_admin',false,false,true),
      ('service_role','postgres','supabase_admin',true,true,true);
  elsif server_major=18 and exists(select 1 from notification_projection_source_edges_before) then
    if (select count(*) from notification_projection_source_edges_before)<>1
      or not exists(select 1 from notification_projection_source_edges_before
        where target='app_ledger' and member=current_user and grantor=current_user
          and not admin_option and inherit_option and set_option) then
      raise exception 'Notification projection PostgreSQL 18 source role graph changed';
    end if;
    insert into notification_projection_expected_source_edges
      values('app_ledger',current_user,current_user,false,true,true);
  elsif server_major<>18 then
    raise exception 'Notification projection requires reviewed PostgreSQL 17 or 18';
  end if;
  if exists((select * from notification_projection_source_edges_before)
      except (select * from notification_projection_expected_source_edges))
    or exists((select * from notification_projection_expected_source_edges)
      except (select * from notification_projection_source_edges_before)) then
    raise exception 'Notification projection source role graph changed';
  end if;

  create temporary table notification_projection_source_reachability_before on commit drop as
  select source.rolname as source,target.authority_role as target,mode.mode
  from pg_roles source
  cross join (values('anon'),('authenticated'),('service_role'),('app_ledger'),(current_user)) target(authority_role)
  cross join (values('MEMBER'),('USAGE'),('SET')) mode(mode)
  where not source.rolsuper and pg_has_role(source.oid,to_regrole(target.authority_role),mode.mode);
  create temporary table notification_projection_expected_source_reachability (
    source text not null,target text not null,mode text not null,primary key(source,target,mode)
  ) on commit drop;
  insert into notification_projection_expected_source_reachability
  select expected_role,expected_role,mode
  from unnest(array['anon','authenticated','service_role','app_ledger']) expected_role
  cross join unnest(array['MEMBER','USAGE','SET']) mode;
  if server_major=17 then
    insert into notification_projection_expected_source_reachability
    select current_user,current_user,mode from unnest(array['MEMBER','USAGE','SET']) mode;
    insert into notification_projection_expected_source_reachability
    select 'authenticator',target,mode
    from unnest(array['anon','authenticated','service_role']) target
    cross join unnest(array['MEMBER','SET']) mode;
    -- Platform-managed chain: Supabase grants its storage service login role the ability to
    -- SET ROLE into authenticator, which is already an admitted member of the three API roles,
    -- so the transitive MEMBER/SET reachability below is Supabase's, not this project's. It is
    -- admitted only when that exact edge is present with exactly these options, and never with
    -- USAGE, so an inheriting or differently granted edge still fails. This adds no authority
    -- over the projection: supabase_storage_admin cannot reach app_notification_worker, and
    -- service_role already holds full privileges on these relations.
    if exists(select 1 from pg_auth_members platform_membership
        join pg_roles platform_target on platform_target.oid=platform_membership.roleid
        join pg_roles platform_member on platform_member.oid=platform_membership.member
        join pg_roles platform_grantor on platform_grantor.oid=platform_membership.grantor
        where platform_target.rolname='authenticator'
          and platform_member.rolname='supabase_storage_admin'
          and platform_grantor.rolname='supabase_admin'
          and not platform_membership.admin_option
          and not platform_membership.inherit_option
          and platform_membership.set_option) then
      insert into notification_projection_expected_source_reachability
      select 'supabase_storage_admin',target,mode
      from unnest(array['anon','authenticated','service_role']) target
      cross join unnest(array['MEMBER','SET']) mode;
    end if;
    insert into notification_projection_expected_source_reachability
    select current_user,target,mode
    from unnest(array['anon','authenticated','service_role','app_ledger']) target
    cross join unnest(array['MEMBER','USAGE','SET']) mode;
  end if;
  if exists((select * from notification_projection_source_reachability_before)
      except (select * from notification_projection_expected_source_reachability))
    or exists((select * from notification_projection_expected_source_reachability)
      except (select * from notification_projection_source_reachability_before)) then
    raise exception 'Notification projection source role reachability changed';
  end if;
  -- Freeze the complete reviewed source-policy set before creating either role.
  select count(*) into policy_count from pg_policy p
    where p.polrelid=any(array[
      'public.organizations'::regclass,'public.organization_members'::regclass,
      'public.profiles'::regclass,'public.member_roles'::regclass,
      'public.permission_rules'::regclass,'public.join_request'::regclass]);
  if policy_count<>12 then raise exception 'Notification projection source policy inventory changed'; end if;
  select count(*) into policy_count from pg_policy p
    where p.polrelid=any(array[
      'public.organizations'::regclass,'public.organization_members'::regclass,
      'public.profiles'::regclass,'public.member_roles'::regclass,
      'public.permission_rules'::regclass,'public.join_request'::regclass])
    and p.polname=any(array[
      'organizations_admin_all','organizations_member_select',
      'organization_members_admin_all','organization_members_self_select','organization_members_org_guc',
      'profiles_self_select','profiles_self_update','member_roles_org_guc',
      'permission_rules_org_guc','join_request_admin_all','join_request_self_insert','join_request_self_select']);
  if policy_count<>12 then raise exception 'Notification projection source policy inventory changed'; end if;
  if exists(
    select 1 from pg_policy p where p.polrelid=any(array[
      'public.organizations'::regclass,'public.organization_members'::regclass,
      'public.profiles'::regclass,'public.permission_rules'::regclass,'public.join_request'::regclass])
      and p.polname=any(array[
        'organizations_admin_all','organizations_member_select',
        'organization_members_admin_all','organization_members_self_select',
        'profiles_self_select','profiles_self_update','permission_rules_org_guc',
        'join_request_admin_all','join_request_self_insert','join_request_self_select'])
      and (not p.polpermissive or p.polroles<>array[0::oid])
  ) then raise exception 'Notification projection PUBLIC source policy changed'; end if;
  if exists(
    select 1 from pg_policy p where
      (p.polrelid='public.organization_members'::regclass and p.polname='organization_members_org_guc'
        or p.polrelid='public.member_roles'::regclass and p.polname='member_roles_org_guc')
      and (not p.polpermissive or p.polroles<>array['app_ledger'::regrole::oid])
  ) then raise exception 'Notification projection app-ledger source policy changed'; end if;
  if exists(
    select 1 from pg_class c where c.oid=any(array[
      'public.organizations'::regclass,'public.organization_members'::regclass,
      'public.profiles'::regclass,'public.member_roles'::regclass,
      'public.permission_rules'::regclass,'public.join_request'::regclass])
      and pg_get_userbyid(c.relowner)=any(array['app_notification_worker','notification_projection_finalizer'])
  ) then raise exception 'Notification projection source ownership is invalid'; end if;
  foreach role_name in array array[
    'app_notification_worker','notification_projection_owner_bridge','notification_projection_finalizer'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      raise exception 'Notification projection role reconciliation required';
    end if;
  end loop;

  create temporary table notification_projection_enqueue_before on commit drop as
  select pg_get_userbyid(p.proowner) as owner_name,p.prosecdef,p.proconfig,p.proacl::text as proacl,
    p.prosrc,pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,l.lanname as language_name
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid='public.notification_event_enqueue()'::regprocedure;
  create temporary table notification_projection_quarantine_before on commit drop as
  select pg_get_userbyid(p.proowner) as owner_name,p.prosecdef,p.proconfig,
    p.prosrc,pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,l.lanname as language_name
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid='public.notification_quarantine_claims(jsonb)'::regprocedure;
  create temporary table notification_projection_event_graph_before on commit drop as
  select target.rolname as target,member.rolname as member,grantor.rolname as grantor,
    membership.admin_option,membership.inherit_option,membership.set_option
  from pg_auth_members membership
  join pg_roles target on target.oid=membership.roleid
  join pg_roles member on member.oid=membership.member
  join pg_roles grantor on grantor.oid=membership.grantor
  where target.rolname='notification_event_trigger' or member.rolname='notification_event_trigger';
  if (select count(*) from notification_projection_enqueue_before)<>1
    or (select owner_name from notification_projection_enqueue_before)<>'notification_event_trigger'
    or not (select prosecdef from notification_projection_enqueue_before)
    or (select proconfig from notification_projection_enqueue_before) is distinct from array['search_path=""']
    or (select identity_arguments from notification_projection_enqueue_before)<>''
    or (select result_type from notification_projection_enqueue_before)<>'trigger'
    or (select language_name from notification_projection_enqueue_before)<>'plpgsql'
    or (select prosrc from notification_projection_enqueue_before) is distinct from $body$
begin
  if tg_relid<>'public.notification_events'::regclass or tg_table_schema<>'public'
    or tg_table_name<>'notification_events' or tg_op<>'INSERT' or tg_when<>'AFTER' then
    raise exception 'Notification enqueue trigger source is invalid';
  end if;
  insert into public.notification_outbox(event_id,organization_id,catalog_revision)
    values(new.id,new.organization_id,new.catalog_revision);
  return new;
end $body$
    or has_schema_privilege('notification_event_trigger','public','CREATE') then
    raise exception 'Notification event trigger owner precondition changed';
  end if;
  if (select count(*) from notification_projection_quarantine_before)<>1
    or (select owner_name from notification_projection_quarantine_before)<>current_user
    or (select prosecdef from notification_projection_quarantine_before)
    or (select proconfig from notification_projection_quarantine_before) is distinct from array['search_path=""']
    or (select identity_arguments from notification_projection_quarantine_before)<>'claims jsonb'
    or (select result_type from notification_projection_quarantine_before)<>'integer'
    or (select language_name from notification_projection_quarantine_before)<>'plpgsql'
    or encode(sha256(convert_to((select prosrc from notification_projection_quarantine_before),'UTF8')),'hex')
      <>'7a241598230de954d6eb71e7239478c3c3f1cd7563129cf47b26a62e5c3406ff'
    or (select count(*) from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.notification_quarantine_claims(jsonb)'::regprocedure
        and acl.privilege_type='EXECUTE' and not acl.is_grantable and acl.grantor=p.proowner
        and acl.grantee in (p.proowner,'notification_worker'::regrole))<>2
    or exists(select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.notification_quarantine_claims(jsonb)'::regprocedure
        and (acl.privilege_type<>'EXECUTE' or acl.is_grantable or acl.grantor<>p.proowner
          or acl.grantee not in (p.proowner,'notification_worker'::regrole))) then
    raise exception 'Notification quarantine function precondition changed';
  end if;
  if server_major=17 then
    if current_user<>'postgres'
      or (select count(*) from notification_projection_event_graph_before)<>1
      or not exists(select 1 from notification_projection_event_graph_before
        where target='notification_event_trigger' and member='postgres' and grantor='supabase_admin'
          and admin_option and not inherit_option and not set_option)
      or pg_has_role(current_user,'notification_event_trigger','SET')
      or pg_has_role(current_user,'notification_event_trigger','USAGE') then
      raise exception 'Notification event trigger PostgreSQL 17 owner graph changed';
    end if;
  elsif server_major=18 then
    if exists(select 1 from notification_projection_event_graph_before) then
      raise exception 'Notification event trigger PostgreSQL 18 owner graph changed';
    end if;
  else
    raise exception 'Notification projection requires reviewed PostgreSQL 17 or 18';
  end if;

  execute format('create role app_notification_worker nologin nosuperuser nobypassrls noinherit '
    'nocreatedb nocreaterole noreplication role %I',current_user);
  execute format('create role notification_projection_owner_bridge nologin nosuperuser nobypassrls '
    'noinherit nocreatedb nocreaterole noreplication in role notification_event_trigger role %I',
    current_user);
  execute 'create role notification_projection_finalizer nologin nosuperuser nobypassrls noinherit '
    'nocreatedb nocreaterole noreplication role notification_projection_owner_bridge';

  if exists(select 1 from pg_roles where rolname=any(array[
      'app_notification_worker','notification_projection_owner_bridge','notification_projection_finalizer'])
      and (rolcanlogin or rolsuper or rolbypassrls or rolinherit or rolcreatedb or rolcreaterole or rolreplication)) then
    raise exception 'Notification projection role attributes are invalid';
  end if;

  select count(*) into temporary_graph_count
  from pg_auth_members membership
  join pg_roles target on target.oid=membership.roleid
  join pg_roles member on member.oid=membership.member
  where target.rolname in ('notification_event_trigger','notification_projection_owner_bridge','notification_projection_finalizer')
     or member.rolname in ('notification_event_trigger','notification_projection_owner_bridge','notification_projection_finalizer');
  select count(*) into app_graph_count from pg_auth_members
    where roleid='app_notification_worker'::regrole;
  if server_major=17 then
    if current_user<>'postgres' or not exists(select 1 from pg_roles where rolname=current_user
        and not rolsuper and rolcreaterole) or temporary_graph_count<>6 or app_graph_count<>2
      or not exists(select 1 from pg_auth_members m
        join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where m.roleid='app_notification_worker'::regrole and u.rolname='postgres'
          and g.rolname='postgres' and not m.admin_option and m.inherit_option and m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where m.roleid='app_notification_worker'::regrole and u.rolname='postgres'
          and g.rolname='supabase_admin' and m.admin_option and not m.inherit_option and not m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_event_trigger' and u.rolname='notification_projection_owner_bridge'
          and g.rolname='postgres' and not m.admin_option and not m.inherit_option and m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_projection_owner_bridge' and u.rolname='postgres'
          and g.rolname='postgres' and not m.admin_option and m.inherit_option and m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_projection_owner_bridge' and u.rolname='postgres'
          and g.rolname='supabase_admin' and m.admin_option and not m.inherit_option and not m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_projection_finalizer'
          and u.rolname='notification_projection_owner_bridge' and g.rolname='postgres'
          and not m.admin_option and not m.inherit_option and m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_projection_finalizer' and u.rolname='postgres'
          and g.rolname='supabase_admin' and m.admin_option and not m.inherit_option and not m.set_option)
    then raise exception 'Notification projection PostgreSQL 17 temporary role graph is invalid'; end if;
  elsif server_major=18 then
    if temporary_graph_count<>3 or app_graph_count<>1
      or not exists(select 1 from pg_auth_members m
        join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where m.roleid='app_notification_worker'::regrole and u.rolname=current_user
          and g.rolname=current_user and not m.admin_option and m.inherit_option and m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_event_trigger' and u.rolname='notification_projection_owner_bridge'
          and g.rolname=current_user and not m.admin_option and not m.inherit_option and m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_projection_owner_bridge' and u.rolname=current_user
          and g.rolname=current_user and not m.admin_option and m.inherit_option and m.set_option)
      or not exists(select 1 from pg_auth_members m
        join pg_roles t on t.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
        where t.rolname='notification_projection_finalizer'
          and u.rolname='notification_projection_owner_bridge' and g.rolname=current_user
          and not m.admin_option and not m.inherit_option and m.set_option)
    then raise exception 'Notification projection PostgreSQL 18 temporary role graph is invalid'; end if;
  else
    raise exception 'Notification projection requires reviewed PostgreSQL 17 or 18';
  end if;

  create temporary table notification_projection_persistent_graph (
    target text not null,member text not null,grantor text not null,
    admin_option boolean not null,inherit_option boolean not null,set_option boolean not null,
    primary key(target,member,grantor)
  ) on commit drop;
  insert into notification_projection_persistent_graph
  select target.rolname,member.rolname,grantor.rolname,
    membership.admin_option,membership.inherit_option,membership.set_option
  from pg_auth_members membership
  join pg_roles target on target.oid=membership.roleid
  join pg_roles member on member.oid=membership.member
  join pg_roles grantor on grantor.oid=membership.grantor
  where (target.rolname in ('notification_event_trigger','notification_projection_finalizer')
      or member.rolname in ('notification_event_trigger','notification_projection_finalizer'))
    and target.rolname<>'notification_projection_owner_bridge'
    and member.rolname<>'notification_projection_owner_bridge';
end $$;

grant usage on schema public to app_notification_worker,notification_projection_finalizer;
create temporary table notification_projection_schema_before on commit drop as
select nspacl::text as nspacl from pg_namespace where nspname='public';

-- Add exact immutable routing and durable terminal-operation attribution.
alter table public.notification_outbox disable trigger notification_outbox_transition;
alter table public.notification_outbox
  add column kind text,
  add column schema_version integer,
  add column terminal_owner_id uuid,
  add column terminal_generation bigint;
-- The backfill below and its completeness guard both read public.notification_outbox, which
-- carries `force row level security` and has no owner policy. An actor that cannot see every row
-- would write zero rows and then read zero nulls, so a fully suppressed backfill would report
-- itself complete and surface later only as a bare not-null violation. Require the visibility
-- this step depends on rather than assuming it; the preflight checks the actor's name, rolsuper
-- and rolcreaterole but not this attribute.
do $$ begin
  if not exists(select 1 from pg_roles
    where rolname=current_user and (rolbypassrls or rolsuper)) then
    raise exception 'Notification projection routing backfill requires an actor that bypasses row level security';
  end if;
end $$;
update public.notification_outbox o set kind=e.kind,schema_version=e.schema_version
  from public.notification_events e
  where e.organization_id=o.organization_id and e.id=o.event_id and e.catalog_revision=o.catalog_revision;
do $$ begin
  if exists(select 1 from public.notification_outbox where kind is null or schema_version is null) then
    raise exception 'Notification projection routing backfill is incomplete';
  end if;
end $$;
alter table public.notification_outbox
  alter column kind set not null,
  alter column schema_version set not null,
  add constraint notification_outbox_kind_check
    check(octet_length(kind) between 1 and 96 and kind ~ '^[a-z][a-z0-9_.]*$'),
  add constraint notification_outbox_schema_version_check check(schema_version between 1 and 65535),
  add constraint notification_outbox_terminal_identity_check check(
    (state in ('pending','processing') and terminal_owner_id is null and terminal_generation is null)
    or (state in ('projected','quarantined') and (
      (terminal_owner_id is null and terminal_generation is null)
      or (terminal_owner_id is not null and terminal_generation=generation and terminal_generation>0)
    ))
  );
alter table public.notification_events
  add constraint notification_events_projection_route_key
  unique(organization_id,id,catalog_revision,kind,schema_version);
alter table public.notification_outbox
  drop constraint notification_outbox_organization_id_event_id_catalog_revis_fkey,
  add constraint notification_outbox_projection_route_fkey
    foreign key(organization_id,event_id,catalog_revision,kind,schema_version)
    references public.notification_events(organization_id,id,catalog_revision,kind,schema_version)
    on delete restrict;
drop index public.notification_pending_claim_idx;
drop index public.notification_expired_claim_idx;
create index notification_pending_claim_idx on public.notification_outbox
  (organization_id,catalog_revision collate "C",kind collate "C",schema_version,event_id)
  where state='pending';
create index notification_expired_claim_idx on public.notification_outbox
  (organization_id,catalog_revision collate "C",kind collate "C",schema_version,lease_expires_at,event_id)
  where state='processing';
alter table public.notification_outbox drop constraint notification_outbox_quarantine_reason_check;
alter table public.notification_outbox add constraint notification_outbox_quarantine_reason_check
  check(quarantine_reason is null or (octet_length(quarantine_reason)<=32 and quarantine_reason in (
    'payload_invalid','digest_mismatch','envelope_invalid','audience_overflow','subject_invalid',
    'audience_authority_overflow','body_invalid','body_overflow','navigation_invalid')));

-- Replace the bounded Slice3 quarantine mutation with one fixed inaccessible authority. The
-- function changes no caller-selected SQL, identifier or role and restores every managed setting.
create or replace function public.notification_quarantine_claims(claims jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare claim jsonb; event_ids uuid[]:=array[]::uuid[]; changed integer; total integer:=0;
  prior_scope_mode text:=current_setting('app.notification_scope_mode',true);
  prior_event_id text:=current_setting('app.notification_event_id',true);
  prior_generation text:=current_setting('app.notification_generation',true);
  prior_reason text:=current_setting('app.notification_quarantine_reason',true);
  organization_setting text:=current_setting('app.current_org_id',true);
  owner_setting text:=current_setting('app.notification_owner',true);
  organization_value uuid; owner_value uuid;
begin
  if jsonb_typeof(claims) is distinct from 'array'
    or prior_scope_mode is null or prior_event_id is null or prior_generation is null or prior_reason is null
    or organization_setting is null or organization_setting !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or owner_setting is null or owner_setting !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Notification quarantine batch is invalid';
  end if;
  organization_value:=organization_setting::uuid;
  owner_value:=owner_setting::uuid;
  if jsonb_array_length(claims)<1 or jsonb_array_length(claims)>250
    or octet_length(claims::text)>65536 then
    raise exception 'Notification quarantine batch is invalid';
  end if;
  for claim in select value from jsonb_array_elements(claims) loop
    if jsonb_typeof(claim) is distinct from 'object'
      or (select array_agg(key order by key) from jsonb_object_keys(claim) key)
        is distinct from array['eventId','generation','reason']
      or jsonb_typeof(claim->'eventId') is distinct from 'string'
      or jsonb_typeof(claim->'generation') is distinct from 'string'
      or jsonb_typeof(claim->'reason') is distinct from 'string'
      or (claim->>'eventId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (claim->>'generation') !~ '^[1-9][0-9]{0,18}$'
      or (claim->>'reason') not in ('payload_invalid','digest_mismatch','envelope_invalid') then
      raise exception 'Notification quarantine batch is invalid';
    end if;
    if (claim->>'generation')::numeric>9223372036854775807
      or (claim->>'eventId')::uuid=any(event_ids) then
      raise exception 'Notification quarantine batch is invalid';
    end if;
    event_ids:=array_append(event_ids,(claim->>'eventId')::uuid);
  end loop;
  perform set_config('app.notification_scope_mode','integrity_quarantine',true);
  for claim in select value from jsonb_array_elements(claims) order by value->>'eventId' collate "C" loop
    perform set_config('app.notification_event_id',claim->>'eventId',true);
    perform set_config('app.notification_generation',claim->>'generation',true);
    perform set_config('app.notification_quarantine_reason',claim->>'reason',true);
    perform 1 from public.notification_outbox
      where organization_id=organization_value and event_id=(claim->>'eventId')::uuid
        and state='processing' and lease_owner=owner_value
        and generation=(claim->>'generation')::bigint and lease_expires_at>clock_timestamp()
      for update;
    if not found then
      perform set_config('app.notification_scope_mode',prior_scope_mode,true);
      perform set_config('app.notification_event_id',prior_event_id,true);
      perform set_config('app.notification_generation',prior_generation,true);
      perform set_config('app.notification_quarantine_reason',prior_reason,true);
      if current_setting('app.notification_scope_mode',true) is distinct from prior_scope_mode
        or current_setting('app.notification_event_id',true) is distinct from prior_event_id
        or current_setting('app.notification_generation',true) is distinct from prior_generation
        or current_setting('app.notification_quarantine_reason',true) is distinct from prior_reason then
        raise exception 'Notification quarantine scope restoration failed';
      end if;
      return 0;
    end if;
  end loop;
  for claim in select value from jsonb_array_elements(claims) order by value->>'eventId' collate "C" loop
    perform set_config('app.notification_event_id',claim->>'eventId',true);
    perform set_config('app.notification_generation',claim->>'generation',true);
    perform set_config('app.notification_quarantine_reason',claim->>'reason',true);
    update public.notification_outbox set state='quarantined',completed_at=clock_timestamp(),
      quarantine_reason=claim->>'reason',lease_owner=null,claimed_at=null,hard_deadline=null,
      lease_expires_at=null,renewal_count=null
      where organization_id=organization_value and event_id=(claim->>'eventId')::uuid
        and state='processing' and lease_owner=owner_value
        and generation=(claim->>'generation')::bigint and lease_expires_at>clock_timestamp();
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'Notification quarantine claim changed during settlement'; end if;
    total:=total+changed;
  end loop;
  perform set_config('app.notification_scope_mode',prior_scope_mode,true);
  perform set_config('app.notification_event_id',prior_event_id,true);
  perform set_config('app.notification_generation',prior_generation,true);
  perform set_config('app.notification_quarantine_reason',prior_reason,true);
  if current_setting('app.notification_scope_mode',true) is distinct from prior_scope_mode
    or current_setting('app.notification_event_id',true) is distinct from prior_event_id
    or current_setting('app.notification_generation',true) is distinct from prior_generation
    or current_setting('app.notification_quarantine_reason',true) is distinct from prior_reason then
    raise exception 'Notification quarantine scope restoration failed';
  end if;
  return total;
end $$;

-- Replace the inaccessible Slice3 enqueue body and transfer the quarantine function through the
-- reviewed initial-membership bridge. The enqueue metadata and schema ACL remain unchanged.
grant create on schema public to notification_event_trigger;
alter function public.notification_quarantine_claims(jsonb) owner to notification_event_trigger;
set local role notification_event_trigger;
revoke all on function public.notification_quarantine_claims(jsonb) from public;
do $$
declare role_row record;
begin
  for role_row in select rolname from pg_roles where rolname<>current_user loop
    execute format('revoke all on function public.notification_quarantine_claims(jsonb) from %I',role_row.rolname);
  end loop;
end $$;
grant execute on function public.notification_quarantine_claims(jsonb) to notification_worker;
create or replace function public.notification_event_enqueue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_relid<>'public.notification_events'::regclass or tg_table_schema<>'public'
    or tg_table_name<>'notification_events' or tg_op<>'INSERT' or tg_when<>'AFTER' then
    raise exception 'Notification enqueue trigger source is invalid';
  end if;
  insert into public.notification_outbox(event_id,organization_id,catalog_revision,kind,schema_version)
    values(new.id,new.organization_id,new.catalog_revision,new.kind,new.schema_version);
  return new;
end $$;
reset role;
revoke create on schema public from notification_event_trigger;
do $$
begin
  if has_schema_privilege('notification_event_trigger','public','CREATE')
    or (select nspacl::text from pg_namespace where nspname='public')
      is distinct from (select nspacl from pg_temp.notification_projection_schema_before) then
    raise exception 'Notification event enqueue replacement changed schema authority';
  end if;
  if not exists(
      select 1 from pg_proc p,pg_temp.notification_projection_enqueue_before b
      where p.oid='public.notification_event_enqueue()'::regprocedure
        and pg_get_userbyid(p.proowner)=b.owner_name
        and p.prosecdef=b.prosecdef
        and p.proconfig is not distinct from b.proconfig
        and p.proacl::text is not distinct from b.proacl
        and pg_get_function_identity_arguments(p.oid)=b.identity_arguments
        and pg_get_function_result(p.oid)=b.result_type
    ) then raise exception 'Notification event enqueue replacement changed owner metadata'; end if;
  if not exists(
      select 1 from pg_proc p where p.oid='public.notification_event_enqueue()'::regprocedure
        and p.prosrc=$body$
begin
  if tg_relid<>'public.notification_events'::regclass or tg_table_schema<>'public'
    or tg_table_name<>'notification_events' or tg_op<>'INSERT' or tg_when<>'AFTER' then
    raise exception 'Notification enqueue trigger source is invalid';
  end if;
  insert into public.notification_outbox(event_id,organization_id,catalog_revision,kind,schema_version)
    values(new.id,new.organization_id,new.catalog_revision,new.kind,new.schema_version);
  return new;
end $body$)
  then raise exception 'Notification event enqueue replacement changed body'; end if;
end $$;

create or replace function public.notification_outbox_transition_guard() returns trigger
language plpgsql set search_path='' as $$
declare now_at timestamptz:=clock_timestamp(); expected_owner text:=current_setting('app.notification_owner',true);
  slice5_reason boolean;
begin
  if tg_op='DELETE' then raise exception 'Notification outbox retention is unavailable'; end if;
  if tg_op='INSERT' then
    if current_user<>'notification_event_trigger' or new.state<>'pending' or new.generation<>0 or new.claim_count<>0
      or new.terminal_owner_id is not null or new.terminal_generation is not null then
      raise exception 'Notification initial claim state is invalid';
    end if;
    return new;
  end if;
  if new.event_id is distinct from old.event_id or new.organization_id is distinct from old.organization_id
    or new.catalog_revision is distinct from old.catalog_revision or new.kind is distinct from old.kind
    or new.schema_version is distinct from old.schema_version
    or old.state in ('projected','quarantined')
    or old.terminal_owner_id is not null or old.terminal_generation is not null then
    raise exception 'Notification claim transition is forbidden';
  end if;
  if current_user='notification_event_trigger'
    and current_setting('app.notification_scope_mode',true)='integrity_quarantine' then
    if old.state<>'processing'
      or old.organization_id::text is distinct from current_setting('app.current_org_id',true)
      or old.event_id::text is distinct from current_setting('app.notification_event_id',true)
      or old.lease_owner::text is distinct from expected_owner
      or old.generation::text is distinct from current_setting('app.notification_generation',true)
      or old.lease_expires_at<=now_at or new.generation<>old.generation
      or new.claim_count<>old.claim_count or new.state<>'quarantined'
      or new.quarantine_reason is distinct from current_setting('app.notification_quarantine_reason',true)
      or new.quarantine_reason not in ('payload_invalid','digest_mismatch','envelope_invalid')
      or new.completed_at is null or new.completed_at<statement_timestamp() or new.completed_at>now_at
      or new.lease_owner is not null or new.claimed_at is not null or new.hard_deadline is not null
      or new.lease_expires_at is not null or new.renewal_count is not null
      or new.terminal_owner_id is not null or new.terminal_generation is not null then
      raise exception 'Notification integrity quarantine transition is invalid';
    end if;
    new.terminal_owner_id:=old.lease_owner;
    new.terminal_generation:=old.generation;
    return new;
  end if;
  if current_user='notification_worker' then
    if current_setting('app.notification_scope_mode',true)='projection_claim'
      and (not exists(select 1 from public.notification_worker_runtime)
        or not exists(select 1 from public.notification_org_control
          where organization_id=new.organization_id)) then
      raise exception 'Notification projection claim fence is unavailable';
    end if;
    if old.state='pending' or (old.state='processing' and old.lease_expires_at<=now_at) then
      if new.state<>'processing' or new.lease_owner::text is distinct from expected_owner
        or new.generation<>old.generation+1 or new.claim_count<>old.claim_count+1
        or new.renewal_count<>0 or new.claimed_at is null or new.claimed_at>now_at
        or new.claimed_at<statement_timestamp() or new.lease_expires_at<>new.claimed_at+interval '30 seconds'
        or new.hard_deadline<>new.claimed_at+interval '60 seconds'
        or new.terminal_owner_id is not null or new.terminal_generation is not null then
        raise exception 'Notification claim admission is invalid';
      end if;
      return new;
    end if;
    if old.lease_owner::text is distinct from expected_owner
      or old.generation::text is distinct from current_setting('app.notification_generation',true)
      or old.lease_expires_at<=now_at or new.generation<>old.generation or new.claim_count<>old.claim_count then
      raise exception 'Notification lease is stale';
    end if;
    if new.state='processing' then
      if new.lease_owner<>old.lease_owner or new.claimed_at<>old.claimed_at or new.hard_deadline<>old.hard_deadline
        or old.renewal_count<>0 or new.renewal_count<>1 or new.lease_expires_at<>old.hard_deadline
        or new.terminal_owner_id is not null or new.terminal_generation is not null then
        raise exception 'Notification renewal is invalid';
      end if;
      return new;
    end if;
    raise exception 'Notification settlement is invalid';
  end if;
  if current_user<>'notification_projection_finalizer'
    or old.state<>'processing' or old.lease_owner::text is distinct from expected_owner
    or old.generation::text is distinct from current_setting('app.notification_generation',true)
    or old.lease_expires_at<=now_at or new.generation<>old.generation or new.claim_count<>old.claim_count then
    raise exception 'Notification projection transition is forbidden';
  end if;
  slice5_reason:=new.quarantine_reason in ('audience_overflow','subject_invalid','audience_authority_overflow',
    'body_invalid','body_overflow','navigation_invalid');
  if (new.state='projected' and new.quarantine_reason is not null)
    or (new.state='quarantined' and not slice5_reason)
    or new.state not in ('projected','quarantined')
    or new.completed_at is null or new.completed_at<statement_timestamp() or new.completed_at>now_at
    or new.lease_owner is not null or new.claimed_at is not null or new.hard_deadline is not null
    or new.lease_expires_at is not null or new.renewal_count is not null then
    raise exception 'Notification projection settlement is invalid';
  end if;
  new.terminal_owner_id:=old.lease_owner;
  new.terminal_generation:=old.generation;
  return new;
end $$;
alter table public.notification_outbox enable trigger notification_outbox_transition;

-- Slice3 claim role can no longer synthesize successful projection.
revoke update(state,completed_at,quarantine_reason,lease_owner,claimed_at,hard_deadline,
  lease_expires_at,renewal_count) on public.notification_outbox from notification_worker;
grant update(state,completed_at,quarantine_reason,lease_owner,claimed_at,hard_deadline,
  lease_expires_at,renewal_count) on public.notification_outbox to notification_worker;
drop policy notification_outbox_worker on public.notification_outbox;
create policy notification_outbox_worker_select on public.notification_outbox
  for select to notification_worker using(
    organization_id=(case when current_setting('app.current_org_id',true)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)
    and state in ('pending','processing'));
create policy notification_outbox_worker_update on public.notification_outbox
  for update to notification_worker
  using(organization_id=(case when current_setting('app.current_org_id',true)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)
    and state in ('pending','processing'))
  with check(organization_id=(case when current_setting('app.current_org_id',true)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)
    and state='processing');

create policy notification_outbox_integrity_owner_select on public.notification_outbox
  for select to notification_event_trigger using(
    current_setting('app.notification_scope_mode',true)='integrity_quarantine'
    and organization_id=(case when current_setting('app.current_org_id',true)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)
    and event_id=(case when current_setting('app.notification_event_id',true)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.notification_event_id',true)::uuid else null::uuid end)
    and generation::text=current_setting('app.notification_generation',true)
    and current_setting('app.notification_quarantine_reason',true)
      in ('payload_invalid','digest_mismatch','envelope_invalid')
    and ((state='processing' and lease_owner::text=current_setting('app.notification_owner',true)
        and lease_expires_at>clock_timestamp())
      or (state='quarantined' and terminal_owner_id::text=current_setting('app.notification_owner',true)
        and terminal_generation::text=current_setting('app.notification_generation',true)
        and quarantine_reason=current_setting('app.notification_quarantine_reason',true))));
create policy notification_outbox_integrity_owner_update on public.notification_outbox
  for update to notification_event_trigger
  using(current_setting('app.notification_scope_mode',true)='integrity_quarantine'
    and organization_id=(case when current_setting('app.current_org_id',true)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)
    and event_id=(case when current_setting('app.notification_event_id',true)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.notification_event_id',true)::uuid else null::uuid end)
    and state='processing' and lease_owner::text=current_setting('app.notification_owner',true)
    and generation::text=current_setting('app.notification_generation',true)
    and lease_expires_at>clock_timestamp())
  with check(current_setting('app.notification_scope_mode',true)='integrity_quarantine'
    and organization_id=(case when current_setting('app.current_org_id',true)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)
    and event_id=(case when current_setting('app.notification_event_id',true)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.notification_event_id',true)::uuid else null::uuid end)
    and state='quarantined' and generation::text=current_setting('app.notification_generation',true)
    and terminal_owner_id::text=current_setting('app.notification_owner',true)
    and terminal_generation::text=current_setting('app.notification_generation',true)
    and quarantine_reason=current_setting('app.notification_quarantine_reason',true)
    and quarantine_reason in ('payload_invalid','digest_mismatch','envelope_invalid')
    and completed_at is not null and lease_owner is null and claimed_at is null
    and hard_deadline is null and lease_expires_at is null and renewal_count is null);

create table public.notification_projection_receipts (
  organization_id uuid not null,
  event_id uuid not null,
  catalog_revision text collate "C" not null,
  kind text collate "C" not null,
  schema_version integer not null,
  projection_kind text not null check(projection_kind='inbox.v1'),
  adapter_revision text not null check(octet_length(adapter_revision) between 1 and 64 and adapter_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]*$'),
  claim_owner_id uuid not null,
  claim_generation bigint not null check(claim_generation>0),
  candidate_count integer not null check(candidate_count between 0 and 10000),
  body_byte_total bigint not null check(body_byte_total between 0 and 81920000),
  candidate_set_sha256 text not null check(candidate_set_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
  finalized_at timestamptz check(isfinite(finalized_at)),
  primary key(organization_id,event_id,projection_kind),
  foreign key(organization_id,event_id,catalog_revision,kind,schema_version)
    references public.notification_events(organization_id,id,catalog_revision,kind,schema_version) on delete restrict
);

create table public.notification_audience_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  projection_kind text not null check(projection_kind='inbox.v1'),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  audience_mode text not null check(audience_mode in ('users_manage','join_applicant')),
  adapter_revision text not null check(octet_length(adapter_revision) between 1 and 64 and adapter_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]*$'),
  authority_sha256 text not null check(authority_sha256 ~ '^[a-f0-9]{64}$'),
  template_key text check(template_key is null or (octet_length(template_key) between 1 and 96 and template_key ~ '^[a-z][a-z0-9_.]*$')),
  template_revision text not null check(octet_length(template_revision) between 1 and 64 and template_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]*$'),
  template_sha256 text not null check(template_sha256 ~ '^[a-f0-9]{64}$'),
  parameters_canonical text check(parameters_canonical is null or (octet_length(parameters_canonical)<=1024 and jsonb_typeof(parameters_canonical::jsonb)='object')),
  navigation_id text check(navigation_id is null or (octet_length(navigation_id) between 1 and 64 and navigation_id ~ '^[a-z][a-z0-9_.]*$')),
  body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
  body_byte_count integer not null check(body_byte_count between 0 and 8192),
  candidate_sha256 text not null check(candidate_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'ready' check(state in ('ready','cancelled')),
  created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
  cancelled_at timestamptz check(isfinite(cancelled_at)),
  cancellation_reason text check(cancellation_reason in ('membership_revoked','capability_revoked','subject_changed',
    'field_scope_changed','organization_inactive','authority_changed')),
  foreign key(organization_id,event_id,projection_kind)
    references public.notification_projection_receipts(organization_id,event_id,projection_kind) on delete restrict,
  unique(organization_id,event_id,recipient_profile_id,projection_kind),
  check((state='ready' and template_key is not null and parameters_canonical is not null and navigation_id is not null
      and cancelled_at is null and cancellation_reason is null)
    or (state='cancelled' and template_key is null and parameters_canonical is null and navigation_id is null
      and cancelled_at is not null and cancellation_reason is not null))
);
create index notification_candidate_recipient_idx on public.notification_audience_candidates
  (organization_id,recipient_profile_id,state,id);
create index notification_candidate_event_idx on public.notification_audience_candidates
  (organization_id,event_id,projection_kind,recipient_profile_id,candidate_sha256);

alter table public.notification_projection_receipts enable row level security;
alter table public.notification_projection_receipts force row level security;
alter table public.notification_audience_candidates enable row level security;
alter table public.notification_audience_candidates force row level security;

create function public.notification_candidate_digest(
  organization_id uuid,event_id uuid,projection_kind text,recipient_profile_id uuid,
  audience_mode text,adapter_revision text,authority_sha256 text,template_key text,
  template_revision text,template_sha256 text,parameters_canonical text,navigation_id text,
  body_sha256 text,body_byte_count integer
) returns text
language sql immutable strict set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_array(
    organization_id::text,event_id::text,projection_kind,recipient_profile_id::text,
    audience_mode,adapter_revision,authority_sha256,template_key,template_revision,
    template_sha256,parameters_canonical,navigation_id,body_sha256,body_byte_count
  )::text,'UTF8')),'hex')
$$;

create function public.notification_projection_receipt_guard() returns trigger
language plpgsql set search_path='' as $$
declare expected_at timestamptz;
begin
  if tg_op='DELETE' then raise exception 'Notification projection receipt retention is unavailable'; end if;
  if tg_op='INSERT' then
    if current_user<>'app_notification_worker' or new.finalized_at is not null then
      raise exception 'Notification projection receipt admission is invalid';
    end if;
    new.created_at:=clock_timestamp();
    return new;
  end if;
  if current_user<>'notification_projection_finalizer' or old.finalized_at is not null
    or new.finalized_at is null
    or (to_jsonb(new)-'finalized_at') is distinct from (to_jsonb(old)-'finalized_at') then
    raise exception 'Notification projection receipt is immutable';
  end if;
  begin expected_at:=current_setting('app.notification_finalized_at',true)::timestamptz;
  exception when others then raise exception 'Notification projection receipt finalization is invalid'; end;
  if new.finalized_at is distinct from expected_at or new.finalized_at<statement_timestamp()
    or new.finalized_at>clock_timestamp() then
    raise exception 'Notification projection receipt finalization is invalid';
  end if;
  return new;
end $$;
create trigger notification_projection_receipt_guard
  before insert or update or delete on public.notification_projection_receipts
  for each row execute function public.notification_projection_receipt_guard();

create function public.notification_candidate_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if current_user<>'app_notification_worker' or new.state<>'ready'
      or new.candidate_sha256 is distinct from public.notification_candidate_digest(
        new.organization_id,new.event_id,new.projection_kind,new.recipient_profile_id,
        new.audience_mode,new.adapter_revision,new.authority_sha256,new.template_key,
        new.template_revision,new.template_sha256,new.parameters_canonical,new.navigation_id,
        new.body_sha256,new.body_byte_count) then
      raise exception 'Notification candidate admission is invalid';
    end if;
    new.created_at:=clock_timestamp();
    return new;
  end if;
  if tg_op<>'UPDATE' or current_user<>'app_notification_worker' or old.state<>'ready'
    or new.state<>'cancelled' or new.cancelled_at is null
    or new.cancelled_at<statement_timestamp() or new.cancelled_at>clock_timestamp()
    or new.cancellation_reason not in ('membership_revoked','capability_revoked','subject_changed',
      'field_scope_changed','organization_inactive','authority_changed')
    or new.template_key is not null or new.parameters_canonical is not null or new.navigation_id is not null
    or (to_jsonb(new)-array['state','cancelled_at','cancellation_reason','template_key','parameters_canonical','navigation_id'])
       is distinct from
       (to_jsonb(old)-array['state','cancelled_at','cancellation_reason','template_key','parameters_canonical','navigation_id']) then
    raise exception 'Notification candidate transition is forbidden';
  end if;
  return new;
end $$;
create trigger notification_candidate_transition before insert or update on public.notification_audience_candidates
  for each row execute function public.notification_candidate_guard();

-- Projection application scope. Every equality is text-to-text so malformed
-- custom settings produce no row rather than reaching an unsafe cast.
create policy notification_projection_runtime_select on public.notification_worker_runtime
  for select to app_notification_worker using(
    current_setting('app.notification_scope_mode',true)='projection' and singleton and schema_version=1
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_runtime_generation',true)
    and build_sha=current_setting('app.notification_build_sha',true)
    and catalog_revision=current_setting('app.notification_catalog_revision',true)
    and catalog_sha256=current_setting('app.notification_catalog_sha256',true)
    and projector_revision=current_setting('app.notification_projector_revision',true)
    and projector_sha256=current_setting('app.notification_projector_sha256',true)
    and lease_expires_at>clock_timestamp());
create policy notification_projection_org_select on public.notification_org_control
  for select to app_notification_worker using(
    current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true) and state='running'
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_org_generation',true)
    and lease_expires_at>clock_timestamp() and hard_deadline>clock_timestamp());
create policy notification_projection_claim_runtime_select on public.notification_worker_runtime
  for select to notification_worker using(
    current_setting('app.notification_scope_mode',true)='projection_claim' and singleton and schema_version=1
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_runtime_generation',true)
    and build_sha=current_setting('app.notification_build_sha',true)
    and catalog_revision=current_setting('app.notification_catalog_revision',true)
    and catalog_sha256=current_setting('app.notification_catalog_sha256',true)
    and projector_revision=current_setting('app.notification_projector_revision',true)
    and projector_sha256=current_setting('app.notification_projector_sha256',true)
    and lease_expires_at>clock_timestamp());
create policy notification_projection_claim_org_select on public.notification_org_control
  for select to notification_worker using(
    current_setting('app.notification_scope_mode',true)='projection_claim'
    and organization_id::text=current_setting('app.current_org_id',true) and state='running'
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_org_generation',true)
    and lease_expires_at>clock_timestamp() and hard_deadline>clock_timestamp());
create policy notification_projection_outbox_select on public.notification_outbox
  for select to app_notification_worker using(
    current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and state='processing' and lease_owner::text=current_setting('app.notification_owner',true)
    and generation::text=current_setting('app.notification_generation',true)
    and lease_expires_at>clock_timestamp()
    and exists(select 1 from public.notification_worker_runtime)
    and exists(select 1 from public.notification_org_control));
create policy notification_projection_event_select on public.notification_events
  for select to app_notification_worker using(
    (current_setting('app.notification_scope_mode',true)='projection'
      and organization_id::text=current_setting('app.current_org_id',true)
      and id::text=current_setting('app.notification_event_id',true)
      and exists(select 1 from public.notification_outbox o where o.organization_id=notification_events.organization_id
        and o.event_id=notification_events.id and o.catalog_revision=notification_events.catalog_revision
        and o.kind=notification_events.kind and o.schema_version=notification_events.schema_version))
    or
    (current_setting('app.notification_scope_mode',true)='revalidation'
      and organization_id::text=current_setting('app.current_org_id',true)
      and exists(select 1 from public.notification_projection_receipts r
        join public.notification_audience_candidates c using(organization_id,event_id,projection_kind)
        where r.organization_id=notification_events.organization_id and r.event_id=notification_events.id
          and c.id::text=current_setting('app.notification_candidate_id',true)
          and c.recipient_profile_id::text=current_setting('app.notification_recipient_profile_id',true)
          and c.authority_sha256=current_setting('app.notification_authority_sha256',true)
          and c.state='ready')));

create policy notification_projection_receipt_insert on public.notification_projection_receipts
  for insert to app_notification_worker with check(
    current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and claim_owner_id::text=current_setting('app.notification_owner',true)
    and claim_generation::text=current_setting('app.notification_generation',true)
    and finalized_at is null
    and exists(select 1 from public.notification_outbox o where o.organization_id=notification_projection_receipts.organization_id
      and o.event_id=notification_projection_receipts.event_id and o.catalog_revision=notification_projection_receipts.catalog_revision
      and o.kind=notification_projection_receipts.kind and o.schema_version=notification_projection_receipts.schema_version));
create policy notification_projection_receipt_revalidate on public.notification_projection_receipts
  for select to app_notification_worker using(
    current_setting('app.notification_scope_mode',true)='revalidation'
    and organization_id::text=current_setting('app.current_org_id',true)
    and exists(select 1 from public.notification_audience_candidates c
      where c.organization_id=notification_projection_receipts.organization_id
        and c.event_id=notification_projection_receipts.event_id
        and c.projection_kind=notification_projection_receipts.projection_kind
        and c.id::text=current_setting('app.notification_candidate_id',true)
        and c.recipient_profile_id::text=current_setting('app.notification_recipient_profile_id',true)
        and c.authority_sha256=current_setting('app.notification_authority_sha256',true)
        and c.state='ready'));
create policy notification_projection_receipt_live_select on public.notification_projection_receipts
  for select to app_notification_worker using(
    current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and claim_owner_id::text=current_setting('app.notification_owner',true)
    and claim_generation::text=current_setting('app.notification_generation',true)
    and finalized_at is null);
create policy notification_projection_candidate_insert on public.notification_audience_candidates
  for insert to app_notification_worker with check(
    current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and state='ready'
    and exists(select 1 from public.notification_projection_receipts r
      where r.organization_id=notification_audience_candidates.organization_id
        and r.event_id=notification_audience_candidates.event_id
        and r.projection_kind=notification_audience_candidates.projection_kind
        and r.claim_owner_id::text=current_setting('app.notification_owner',true)
        and r.claim_generation::text=current_setting('app.notification_generation',true)
        and r.finalized_at is null));
create policy notification_projection_candidate_revalidate_select on public.notification_audience_candidates
  for select to app_notification_worker using(
    current_setting('app.notification_scope_mode',true)='revalidation'
    and organization_id::text=current_setting('app.current_org_id',true)
    and id::text=current_setting('app.notification_candidate_id',true)
    and recipient_profile_id::text=current_setting('app.notification_recipient_profile_id',true)
    and authority_sha256=current_setting('app.notification_authority_sha256',true)
    and state in ('ready','cancelled'));
create policy notification_projection_candidate_revalidate_update on public.notification_audience_candidates
  for update to app_notification_worker
  using(current_setting('app.notification_scope_mode',true)='revalidation'
    and organization_id::text=current_setting('app.current_org_id',true)
    and id::text=current_setting('app.notification_candidate_id',true)
    and recipient_profile_id::text=current_setting('app.notification_recipient_profile_id',true)
    and authority_sha256=current_setting('app.notification_authority_sha256',true) and state='ready')
  with check(current_setting('app.notification_scope_mode',true)='revalidation'
    and organization_id::text=current_setting('app.current_org_id',true)
    and id::text=current_setting('app.notification_candidate_id',true)
    and recipient_profile_id::text=current_setting('app.notification_recipient_profile_id',true)
    and authority_sha256=current_setting('app.notification_authority_sha256',true) and state='cancelled');

create function public.notification_projection_source_fence(expected_org uuid) returns boolean
language sql volatile set search_path='' as $$
  select case current_setting('app.notification_scope_mode',true)
    when 'projection' then expected_org::text=current_setting('app.current_org_id',true)
      and exists(select 1 from public.notification_worker_runtime)
      and exists(select 1 from public.notification_org_control where organization_id=expected_org)
      and exists(select 1 from public.notification_outbox where organization_id=expected_org)
    when 'revalidation' then expected_org::text=current_setting('app.current_org_id',true)
      and exists(select 1 from public.notification_audience_candidates c
        where c.organization_id=expected_org
          and c.id::text=current_setting('app.notification_candidate_id',true)
          and c.recipient_profile_id::text=current_setting('app.notification_recipient_profile_id',true)
          and c.authority_sha256=current_setting('app.notification_authority_sha256',true)
          and c.state='ready')
    else false end
$$;

-- Final publication is the only operation that takes all three authority locks.
create policy notification_finalizer_runtime_select on public.notification_worker_runtime
  for select to notification_projection_finalizer using(
    current_setting('app.notification_scope_mode',true)='projection' and singleton and schema_version=1
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_runtime_generation',true)
    and build_sha=current_setting('app.notification_build_sha',true)
    and catalog_revision=current_setting('app.notification_catalog_revision',true)
    and catalog_sha256=current_setting('app.notification_catalog_sha256',true)
    and projector_revision=current_setting('app.notification_projector_revision',true)
    and projector_sha256=current_setting('app.notification_projector_sha256',true));
create policy notification_finalizer_runtime_update on public.notification_worker_runtime
  for update to notification_projection_finalizer
  using(current_setting('app.notification_scope_mode',true)='projection' and singleton and schema_version=1
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_runtime_generation',true)
    and build_sha=current_setting('app.notification_build_sha',true)
    and catalog_revision=current_setting('app.notification_catalog_revision',true)
    and catalog_sha256=current_setting('app.notification_catalog_sha256',true)
    and projector_revision=current_setting('app.notification_projector_revision',true)
    and projector_sha256=current_setting('app.notification_projector_sha256',true))
  with check(singleton and schema_version=1
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_runtime_generation',true));
create policy notification_finalizer_org_select on public.notification_org_control
  for select to notification_projection_finalizer using(
    current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true) and state='running'
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_org_generation',true));
create policy notification_finalizer_org_update on public.notification_org_control
  for update to notification_projection_finalizer
  using(current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true) and state='running'
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_org_generation',true))
  with check(organization_id::text=current_setting('app.current_org_id',true) and state='running'
    and owner_id::text=current_setting('app.notification_runtime_owner',true)
    and generation::text=current_setting('app.notification_org_generation',true));
create policy notification_finalizer_outbox_select on public.notification_outbox
  for select to notification_projection_finalizer using(
    (current_setting('app.notification_scope_mode',true)='projection'
      and organization_id::text=current_setting('app.current_org_id',true)
      and event_id::text=current_setting('app.notification_event_id',true)
      and catalog_revision=current_setting('app.notification_event_catalog_revision',true)
      and kind=current_setting('app.notification_event_kind',true)
      and schema_version::text=current_setting('app.notification_event_schema_version',true)
      and ((state='processing' and lease_owner::text=current_setting('app.notification_owner',true)
          and generation::text=current_setting('app.notification_generation',true))
        or (state in ('projected','quarantined')
          and terminal_owner_id::text=current_setting('app.notification_owner',true)
          and terminal_generation::text=current_setting('app.notification_generation',true))))
    or (current_setting('app.notification_scope_mode',true)='projection_reconcile'
      and organization_id::text=current_setting('app.current_org_id',true)
      and event_id::text=current_setting('app.notification_event_id',true)
      and catalog_revision=current_setting('app.notification_event_catalog_revision',true)
      and kind=current_setting('app.notification_event_kind',true)
      and schema_version::text=current_setting('app.notification_event_schema_version',true))
    or (current_setting('app.notification_scope_mode',true)='projection_commit_guard'
      and organization_id::text=current_setting('app.current_org_id',true)
      and event_id::text=current_setting('app.notification_event_id',true)
      and catalog_revision=current_setting('app.notification_event_catalog_revision',true)
      and kind=current_setting('app.notification_event_kind',true)
      and schema_version::text=current_setting('app.notification_event_schema_version',true)
      and state='projected'
      and terminal_owner_id::text=current_setting('app.notification_owner',true)
      and terminal_generation::text=current_setting('app.notification_generation',true)));
create policy notification_finalizer_outbox_update on public.notification_outbox
  for update to notification_projection_finalizer
  using(current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and catalog_revision=current_setting('app.notification_event_catalog_revision',true)
    and kind=current_setting('app.notification_event_kind',true)
    and schema_version::text=current_setting('app.notification_event_schema_version',true)
    and state='processing' and lease_owner::text=current_setting('app.notification_owner',true)
    and generation::text=current_setting('app.notification_generation',true))
  with check(organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and catalog_revision=current_setting('app.notification_event_catalog_revision',true)
    and kind=current_setting('app.notification_event_kind',true)
    and schema_version::text=current_setting('app.notification_event_schema_version',true)
    and state in ('projected','quarantined')
    and terminal_owner_id::text=current_setting('app.notification_owner',true)
    and terminal_generation::text=current_setting('app.notification_generation',true));
create policy notification_finalizer_receipt_select on public.notification_projection_receipts
  for select to notification_projection_finalizer using(
    organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and catalog_revision=current_setting('app.notification_event_catalog_revision',true)
    and kind=current_setting('app.notification_event_kind',true)
    and schema_version::text=current_setting('app.notification_event_schema_version',true)
    and projection_kind=current_setting('app.notification_projection_kind',true)
    and claim_owner_id::text=current_setting('app.notification_owner',true)
    and claim_generation::text=current_setting('app.notification_generation',true)
    and current_setting('app.notification_scope_mode',true)
      in ('projection','projection_reconcile','projection_commit_guard'));
create policy notification_finalizer_receipt_update on public.notification_projection_receipts
  for update to notification_projection_finalizer
  using(current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and projection_kind=current_setting('app.notification_projection_kind',true)
    and claim_owner_id::text=current_setting('app.notification_owner',true)
    and claim_generation::text=current_setting('app.notification_generation',true)
    and finalized_at is null)
  with check(organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and projection_kind=current_setting('app.notification_projection_kind',true)
    and claim_owner_id::text=current_setting('app.notification_owner',true)
    and claim_generation::text=current_setting('app.notification_generation',true)
    and finalized_at is not null);
create policy notification_finalizer_candidate_select on public.notification_audience_candidates
  for select to notification_projection_finalizer using(
    current_setting('app.notification_scope_mode',true)='projection'
    and organization_id::text=current_setting('app.current_org_id',true)
    and event_id::text=current_setting('app.notification_event_id',true)
    and projection_kind=current_setting('app.notification_projection_kind',true)
    and exists(select 1 from public.notification_projection_receipts r
      where r.organization_id=notification_audience_candidates.organization_id
        and r.event_id=notification_audience_candidates.event_id
        and r.projection_kind=notification_audience_candidates.projection_kind
        and r.claim_owner_id::text=current_setting('app.notification_owner',true)
        and r.claim_generation::text=current_setting('app.notification_generation',true)
        and r.finalized_at is null));

create function public.notification_finalize_audience(outcome text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare runtime_row record; org_row record; outbox_row record; receipt_row record; aggregate_row record;
  now_at timestamptz; updated integer; settlement_reason text;
begin
  if outcome is null or outcome<>lower(outcome) or octet_length(outcome)>32
    or outcome not in ('projected','audience_overflow','subject_invalid','audience_authority_overflow',
      'body_invalid','body_overflow','navigation_invalid')
    or current_setting('app.notification_scope_mode',true)<>'projection' then return false; end if;
  select lease_expires_at into runtime_row from public.notification_worker_runtime
    where singleton and schema_version=1 for update;
  if not found then return false; end if;
  select lease_expires_at,hard_deadline into org_row from public.notification_org_control
    where organization_id::text=current_setting('app.current_org_id',true) for update;
  if not found then return false; end if;
  select organization_id,event_id,catalog_revision,kind,schema_version,state,lease_owner,generation,
      lease_expires_at,hard_deadline into outbox_row from public.notification_outbox
    where organization_id::text=current_setting('app.current_org_id',true)
      and event_id::text=current_setting('app.notification_event_id',true) for update;
  if not found then return false; end if;
  now_at:=clock_timestamp();
  if runtime_row.lease_expires_at<=now_at+interval '3 seconds'
    or org_row.lease_expires_at<=now_at+interval '3 seconds'
    or org_row.hard_deadline<=now_at+interval '3 seconds'
    or outbox_row.lease_expires_at<=now_at+interval '3 seconds'
    or outbox_row.hard_deadline<=now_at+interval '3 seconds' then return false; end if;

  select count(*)::integer as candidate_count,coalesce(sum(body_byte_count),0)::bigint as body_bytes,
    encode(sha256(convert_to('['||coalesce(string_agg(to_json(candidate_sha256)::text,','
      order by recipient_profile_id::text collate "C",candidate_sha256 collate "C"),'')||']','UTF8')),'hex') as set_sha
    into aggregate_row from public.notification_audience_candidates
    where organization_id=outbox_row.organization_id and event_id=outbox_row.event_id
      and projection_kind=current_setting('app.notification_projection_kind',true);
  select claim_owner_id,claim_generation,candidate_count,body_byte_total,candidate_set_sha256,finalized_at
    into receipt_row from public.notification_projection_receipts
    where organization_id=outbox_row.organization_id and event_id=outbox_row.event_id
      and projection_kind=current_setting('app.notification_projection_kind',true);
  if outcome='projected' then
    if receipt_row is null or receipt_row.finalized_at is not null
      or receipt_row.claim_owner_id is distinct from outbox_row.lease_owner
      or receipt_row.claim_generation is distinct from outbox_row.generation
      or receipt_row.candidate_count is distinct from aggregate_row.candidate_count
      or receipt_row.body_byte_total is distinct from aggregate_row.body_bytes
      or receipt_row.candidate_set_sha256 is distinct from aggregate_row.set_sha then return false; end if;
    perform set_config('app.notification_finalized_at',now_at::text,true);
    update public.notification_projection_receipts set finalized_at=now_at
      where organization_id=outbox_row.organization_id and event_id=outbox_row.event_id
        and projection_kind=current_setting('app.notification_projection_kind',true) and finalized_at is null;
    get diagnostics updated=row_count;
    if updated<>1 then return false; end if;
    settlement_reason:=null;
  else
    if receipt_row is not null or aggregate_row.candidate_count<>0 then return false; end if;
    settlement_reason:=outcome;
  end if;
  update public.notification_outbox set state=case when outcome='projected' then 'projected' else 'quarantined' end,
    completed_at=now_at,quarantine_reason=settlement_reason,lease_owner=null,claimed_at=null,
    hard_deadline=null,lease_expires_at=null,renewal_count=null,
    terminal_owner_id=outbox_row.lease_owner,terminal_generation=outbox_row.generation
    where organization_id=outbox_row.organization_id and event_id=outbox_row.event_id
      and state='processing' and generation=outbox_row.generation;
  get diagnostics updated=row_count;
  return updated=1;
end $$;

create function public.notification_observe_audience() returns text
language plpgsql volatile security definer set search_path='' as $$
declare outbox_row record; receipt_row record;
begin
  if current_setting('app.notification_scope_mode',true)<>'projection_reconcile' then return 'absent'; end if;
  select organization_id,event_id,catalog_revision,kind,schema_version,state,lease_owner,generation,
      terminal_owner_id,terminal_generation into outbox_row from public.notification_outbox
    where organization_id::text=current_setting('app.current_org_id',true)
      and event_id::text=current_setting('app.notification_event_id',true)
      and catalog_revision=current_setting('app.notification_event_catalog_revision',true)
      and kind=current_setting('app.notification_event_kind',true)
      and schema_version::text=current_setting('app.notification_event_schema_version',true);
  if not found then return 'absent'; end if;
  select claim_owner_id,claim_generation,finalized_at into receipt_row
    from public.notification_projection_receipts
    where organization_id=outbox_row.organization_id and event_id=outbox_row.event_id
      and projection_kind=current_setting('app.notification_projection_kind',true);
  if (outbox_row.terminal_owner_id is null)<>(outbox_row.terminal_generation is null) then return 'integrity_failed'; end if;
  if outbox_row.state='pending' then
    if receipt_row is not null then return 'integrity_failed'; end if;
    return 'pending';
  end if;
  if outbox_row.state='processing' then
    if receipt_row is not null and receipt_row.finalized_at is not null then return 'integrity_failed'; end if;
    if outbox_row.lease_owner::text=current_setting('app.notification_owner',true)
      and outbox_row.generation::text=current_setting('app.notification_generation',true) then
      return 'same_generation_processing';
    end if;
    return 'superseded';
  end if;
  if outbox_row.terminal_owner_id is null then return 'terminal_unattributed'; end if;
  if outbox_row.terminal_owner_id::text<>current_setting('app.notification_owner',true)
    or outbox_row.terminal_generation::text<>current_setting('app.notification_generation',true) then
    return 'superseded';
  end if;
  if outbox_row.state='quarantined' then
    if receipt_row is not null and receipt_row.finalized_at is not null then return 'integrity_failed'; end if;
    return 'quarantined';
  end if;
  if outbox_row.state='projected' then
    if receipt_row is null or receipt_row.finalized_at is null
      or receipt_row.claim_owner_id is distinct from outbox_row.terminal_owner_id
      or receipt_row.claim_generation is distinct from outbox_row.terminal_generation then
      return 'integrity_failed';
    end if;
    return 'committed';
  end if;
  return 'integrity_failed';
end $$;

create function public.notification_projection_commit_guard() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare valid boolean;
begin
  if tg_relid<>'public.notification_projection_receipts'::regclass
    or tg_op<>'INSERT' or tg_when<>'AFTER'
    or tg_name<>'notification_projection_receipt_commit_guard' or tg_nargs<>0 then
    raise exception 'Notification projection commit guard source is invalid';
  end if;
  perform set_config('app.notification_scope_mode','projection_commit_guard',true);
  perform set_config('app.current_org_id',new.organization_id::text,true);
  perform set_config('app.notification_event_id',new.event_id::text,true);
  perform set_config('app.notification_event_catalog_revision',new.catalog_revision,true);
  perform set_config('app.notification_event_kind',new.kind,true);
  perform set_config('app.notification_event_schema_version',new.schema_version::text,true);
  perform set_config('app.notification_projection_kind',new.projection_kind,true);
  perform set_config('app.notification_owner',new.claim_owner_id::text,true);
  perform set_config('app.notification_generation',new.claim_generation::text,true);
  select exists(
    select 1 from public.notification_projection_receipts r
    join public.notification_outbox o using(organization_id,event_id,catalog_revision,kind,schema_version)
    where r.organization_id=new.organization_id and r.event_id=new.event_id
      and r.projection_kind=new.projection_kind and r.adapter_revision=new.adapter_revision
      and r.claim_owner_id=new.claim_owner_id and r.claim_generation=new.claim_generation
      and r.candidate_count=new.candidate_count and r.body_byte_total=new.body_byte_total
      and r.candidate_set_sha256=new.candidate_set_sha256 and r.created_at=new.created_at
      and r.finalized_at is not null and o.state='projected'
      and o.terminal_owner_id=r.claim_owner_id and o.terminal_generation=r.claim_generation
      and clock_timestamp()<=r.finalized_at+interval '3 seconds'
  ) into valid;
  if not valid then raise exception 'Notification projection commit is incomplete'; end if;
  return new;
end $$;

create constraint trigger notification_projection_receipt_commit_guard
  after insert on public.notification_projection_receipts deferrable initially deferred
  for each row execute function public.notification_projection_commit_guard();

-- Strip default relation and function ACLs before installing the finite grants.
do $$
declare role_row record; relation_name text; signature text;
begin
  foreach relation_name in array array['notification_projection_receipts','notification_audience_candidates'] loop
    execute format('revoke all on table public.%I from public',relation_name);
    for role_row in select rolname from pg_roles where rolname<>current_user loop
      execute format('revoke all on table public.%I from %I',relation_name,role_row.rolname);
    end loop;
  end loop;
  foreach signature in array array[
    'public.notification_candidate_digest(uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,text,integer)',
    'public.notification_projection_receipt_guard()',
    'public.notification_candidate_guard()',
    'public.notification_projection_source_fence(uuid)',
    'public.notification_finalize_audience(text)',
    'public.notification_observe_audience()',
    'public.notification_projection_commit_guard()'] loop
    execute format('revoke all on function %s from public',signature);
    for role_row in select rolname from pg_roles where rolname<>current_user loop
      execute format('revoke all on function %s from %I',signature,role_row.rolname);
    end loop;
  end loop;
end $$;

grant select(singleton,schema_version,owner_id,generation,lease_expires_at,build_sha,catalog_revision,
  catalog_sha256,projector_revision,projector_sha256) on public.notification_worker_runtime to app_notification_worker;
grant select(organization_id,state,owner_id,generation,lease_expires_at,hard_deadline)
  on public.notification_org_control to app_notification_worker;
grant select(event_id,organization_id,catalog_revision,kind,schema_version,state,lease_owner,generation,
  claimed_at,hard_deadline,lease_expires_at,renewal_count,terminal_owner_id,terminal_generation)
  on public.notification_outbox to app_notification_worker;
grant select(id,organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,
  subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,semantic_sha256)
  on public.notification_events to app_notification_worker;
grant insert(organization_id,event_id,catalog_revision,kind,schema_version,projection_kind,adapter_revision,
  claim_owner_id,claim_generation,candidate_count,body_byte_total,candidate_set_sha256)
  on public.notification_projection_receipts to app_notification_worker;
grant select(organization_id,event_id,catalog_revision,kind,schema_version,projection_kind,adapter_revision,
  claim_owner_id,claim_generation,candidate_count,body_byte_total,candidate_set_sha256,created_at,finalized_at)
  on public.notification_projection_receipts to app_notification_worker;
grant insert(organization_id,event_id,projection_kind,recipient_profile_id,audience_mode,adapter_revision,
  authority_sha256,template_key,template_revision,template_sha256,parameters_canonical,navigation_id,
  body_sha256,body_byte_count,candidate_sha256)
  on public.notification_audience_candidates to app_notification_worker;
grant select(id,organization_id,event_id,projection_kind,recipient_profile_id,audience_mode,adapter_revision,
  authority_sha256,template_key,template_revision,template_sha256,parameters_canonical,navigation_id,
  body_sha256,body_byte_count,candidate_sha256,state,created_at,cancelled_at,cancellation_reason)
  on public.notification_audience_candidates to app_notification_worker;
grant update(state,cancelled_at,cancellation_reason,template_key,parameters_canonical,navigation_id)
  on public.notification_audience_candidates to app_notification_worker;
grant select(singleton,schema_version,owner_id,generation,lease_expires_at,build_sha,catalog_revision,
  catalog_sha256,projector_revision,projector_sha256) on public.notification_worker_runtime to notification_worker;
grant select(organization_id,state,owner_id,generation,lease_expires_at,hard_deadline)
  on public.notification_org_control to notification_worker;
-- Slice4 discovery now selects exact projection tuples. These two columns were introduced above,
-- so its existing column grant cannot include them until this migration owns the schema change.
grant select(kind,schema_version) on public.notification_outbox to notification_coordinator;
grant select(organization_id,event_id,state,lease_owner,generation,claimed_at,hard_deadline,
  lease_expires_at,renewal_count,completed_at,quarantine_reason,terminal_owner_id,terminal_generation)
  on public.notification_outbox to notification_event_trigger;
grant update(state,completed_at,quarantine_reason,lease_owner,claimed_at,hard_deadline,
  lease_expires_at,renewal_count) on public.notification_outbox to notification_event_trigger;

grant select(singleton,schema_version,owner_id,generation,lease_expires_at,build_sha,catalog_revision,
  catalog_sha256,projector_revision,projector_sha256) on public.notification_worker_runtime to notification_projection_finalizer;
grant update(generation) on public.notification_worker_runtime to notification_projection_finalizer;
grant select(organization_id,state,owner_id,generation,lease_expires_at,hard_deadline)
  on public.notification_org_control to notification_projection_finalizer;
grant update(generation) on public.notification_org_control to notification_projection_finalizer;
grant select(event_id,organization_id,catalog_revision,kind,schema_version,state,lease_owner,generation,
  lease_expires_at,hard_deadline,terminal_owner_id,terminal_generation)
  on public.notification_outbox to notification_projection_finalizer;
grant update(state,completed_at,quarantine_reason,lease_owner,claimed_at,hard_deadline,lease_expires_at,
  renewal_count,terminal_owner_id,terminal_generation) on public.notification_outbox to notification_projection_finalizer;
grant select(organization_id,event_id,catalog_revision,kind,schema_version,projection_kind,adapter_revision,
  claim_owner_id,claim_generation,candidate_count,body_byte_total,candidate_set_sha256,created_at,finalized_at)
  on public.notification_projection_receipts to notification_projection_finalizer;
grant update(finalized_at) on public.notification_projection_receipts to notification_projection_finalizer;
grant select(organization_id,event_id,projection_kind,recipient_profile_id,candidate_sha256,body_byte_count)
  on public.notification_audience_candidates to notification_projection_finalizer;

grant execute on function public.notification_candidate_digest(uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,text,integer)
  to app_notification_worker;
grant execute on function public.notification_projection_source_fence(uuid) to app_notification_worker;
grant execute on function public.notification_finalize_audience(text) to app_notification_worker;
grant execute on function public.notification_observe_audience() to app_notification_worker;

-- Transfer exactly the three fixed definer functions through the admitted initial-membership
-- bridge. A direct second finalizer GRANT/REVOKE crashes the supported Supabase PostgreSQL 17 image.
grant create on schema public to notification_projection_finalizer;
alter function public.notification_finalize_audience(text) owner to notification_projection_finalizer;
alter function public.notification_observe_audience() owner to notification_projection_finalizer;
alter function public.notification_projection_commit_guard() owner to notification_projection_finalizer;
revoke create on schema public from notification_projection_finalizer;
drop role notification_projection_owner_bridge;

do $$
declare forbidden text; finalizer_edge_count integer; event_owner_edge_count integer;
  app_edge_count integer; exact_owner_count integer; event_owner_function_count integer;
  server_major integer:=current_setting('server_version_num')::integer/10000;
begin
  foreach forbidden in array array['app_ledger','notification_worker','notification_coordinator',
    'notification_health_reader','notification_event_trigger','anon','authenticated','service_role',
    'app_assistant_ro','brain_vector_worker'] loop
    if to_regrole(forbidden) is not null and (
      pg_has_role(to_regrole(forbidden),to_regrole('app_notification_worker'),'MEMBER')
      or pg_has_role(to_regrole(forbidden),to_regrole('notification_projection_finalizer'),'MEMBER')) then
      raise exception 'Notification projection role is reachable from an application principal';
    end if;
  end loop;
  if to_regrole('notification_projection_owner_bridge') is not null
    or has_schema_privilege('notification_projection_finalizer','public','CREATE')
    or has_schema_privilege('notification_event_trigger','public','CREATE')
    or (select nspacl::text from pg_namespace where nspname='public')
      is distinct from (select nspacl from pg_temp.notification_projection_schema_before) then
    raise exception 'Notification projection finalizer runtime authority was retained';
  end if;
  if not (select rolsuper from pg_roles where rolname=current_user)
    and (pg_has_role(current_user,'notification_projection_finalizer','SET')
      or pg_has_role(current_user,'notification_projection_finalizer','USAGE')
      or pg_has_role(current_user,'notification_event_trigger','SET')
      or pg_has_role(current_user,'notification_event_trigger','USAGE')) then
    raise exception 'Notification projection migration actor retained finalizer authority';
  end if;
  if exists(
    (select target.rolname,member.rolname,grantor.rolname,
        membership.admin_option,membership.inherit_option,membership.set_option
      from pg_auth_members membership
      join pg_roles target on target.oid=membership.roleid
      join pg_roles member on member.oid=membership.member
      join pg_roles grantor on grantor.oid=membership.grantor
      where target.rolname in ('notification_event_trigger','notification_projection_finalizer')
         or member.rolname in ('notification_event_trigger','notification_projection_finalizer'))
    except
    (select target,member,grantor,admin_option,inherit_option,set_option
      from pg_temp.notification_projection_persistent_graph)
  ) or exists(
    (select target,member,grantor,admin_option,inherit_option,set_option
      from pg_temp.notification_projection_persistent_graph)
    except
    (select target.rolname,member.rolname,grantor.rolname,
        membership.admin_option,membership.inherit_option,membership.set_option
      from pg_auth_members membership
      join pg_roles target on target.oid=membership.roleid
      join pg_roles member on member.oid=membership.member
      join pg_roles grantor on grantor.oid=membership.grantor
      where target.rolname in ('notification_event_trigger','notification_projection_finalizer')
         or member.rolname in ('notification_event_trigger','notification_projection_finalizer'))
  ) then raise exception 'Notification projection persistent owner graph changed'; end if;
  if not exists(
    select 1 from pg_proc p,pg_temp.notification_projection_enqueue_before b
    where p.oid='public.notification_event_enqueue()'::regprocedure
      and pg_get_userbyid(p.proowner)=b.owner_name
      and p.prosecdef=b.prosecdef
      and p.proconfig is not distinct from b.proconfig
      and p.proacl::text is not distinct from b.proacl
      and pg_get_function_identity_arguments(p.oid)=b.identity_arguments
      and pg_get_function_result(p.oid)=b.result_type
      and p.prosrc=$body$
begin
  if tg_relid<>'public.notification_events'::regclass or tg_table_schema<>'public'
    or tg_table_name<>'notification_events' or tg_op<>'INSERT' or tg_when<>'AFTER' then
    raise exception 'Notification enqueue trigger source is invalid';
  end if;
  insert into public.notification_outbox(event_id,organization_id,catalog_revision,kind,schema_version)
    values(new.id,new.organization_id,new.catalog_revision,new.kind,new.schema_version);
  return new;
end $body$)
  then raise exception 'Notification event enqueue committed metadata or body changed'; end if;
  if not exists(
    select 1 from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid='public.notification_quarantine_claims(jsonb)'::regprocedure
      and pg_get_userbyid(p.proowner)='notification_event_trigger' and p.prosecdef
      and p.proconfig is not distinct from array['search_path=""']
      and pg_get_function_identity_arguments(p.oid)='claims jsonb'
      and pg_get_function_result(p.oid)='integer' and l.lanname='plpgsql'
      and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
        ='333d8775672172221aab54c37032898dcd1c6247d712094208a80bc53626ccea'
  ) or (select count(*) from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.notification_quarantine_claims(jsonb)'::regprocedure
        and acl.privilege_type='EXECUTE' and not acl.is_grantable and acl.grantor=p.proowner
        and acl.grantee in (p.proowner,'notification_worker'::regrole))<>2
    or exists(select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.notification_quarantine_claims(jsonb)'::regprocedure
        and (acl.privilege_type<>'EXECUTE' or acl.is_grantable or acl.grantor<>p.proowner
          or acl.grantee not in (p.proowner,'notification_worker'::regrole))) then
    raise exception 'Notification quarantine function committed metadata changed';
  end if;
  select count(*) into event_owner_function_count from pg_proc
    where proowner='notification_event_trigger'::regrole
      and oid=any(array['public.notification_event_enqueue()'::regprocedure,
        'public.notification_quarantine_claims(jsonb)'::regprocedure]);
  if event_owner_function_count<>2 or (select count(*) from pg_proc
      where proowner='notification_event_trigger'::regrole)<>2
    or exists(select 1 from pg_class where relowner='notification_event_trigger'::regrole)
    or exists(select 1 from pg_namespace where nspowner='notification_event_trigger'::regrole) then
    raise exception 'Notification event owner inventory is invalid';
  end if;
  if (select count(*) from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      where c.oid='public.notification_outbox'::regclass
        and acl.grantee='notification_event_trigger'::regrole
        and acl.grantor=c.relowner and acl.privilege_type='INSERT' and not acl.is_grantable)<>1
    or exists(select 1 from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      where c.oid='public.notification_outbox'::regclass
        and acl.grantee='notification_event_trigger'::regrole
        and (acl.grantor<>c.relowner or acl.privilege_type<>'INSERT' or acl.is_grantable)) then
    raise exception 'Notification integrity owner table ACL is invalid';
  end if;
  if (select count(*) from pg_class c join pg_attribute a on a.attrelid=c.oid
      cross join lateral aclexplode(a.attacl) acl
      where c.oid='public.notification_outbox'::regclass and a.attnum>0 and not a.attisdropped
        and acl.grantee='notification_event_trigger'::regrole and acl.grantor=c.relowner
        and not acl.is_grantable and ((acl.privilege_type='SELECT' and a.attname=any(array[
          'organization_id','event_id','state','lease_owner','generation','claimed_at','hard_deadline',
          'lease_expires_at','renewal_count','completed_at','quarantine_reason','terminal_owner_id','terminal_generation']))
          or (acl.privilege_type='UPDATE' and a.attname=any(array[
          'state','completed_at','quarantine_reason','lease_owner','claimed_at','hard_deadline',
          'lease_expires_at','renewal_count']))))<>21
    or exists(select 1 from pg_class c join pg_attribute a on a.attrelid=c.oid
      cross join lateral aclexplode(a.attacl) acl
      where c.oid='public.notification_outbox'::regclass and a.attnum>0 and not a.attisdropped
        and acl.grantee='notification_event_trigger'::regrole and
        (acl.grantor<>c.relowner or acl.is_grantable
          or (acl.privilege_type='SELECT' and a.attname<>all(array[
            'organization_id','event_id','state','lease_owner','generation','claimed_at','hard_deadline',
            'lease_expires_at','renewal_count','completed_at','quarantine_reason','terminal_owner_id','terminal_generation']))
          or (acl.privilege_type='UPDATE' and a.attname<>all(array[
            'state','completed_at','quarantine_reason','lease_owner','claimed_at','hard_deadline',
            'lease_expires_at','renewal_count']))
          or acl.privilege_type not in ('SELECT','UPDATE'))) then
    raise exception 'Notification integrity owner column ACL is invalid';
  end if;
  if (select count(*) from pg_policy where polrelid='public.notification_outbox'::regclass
      and polname in ('notification_outbox_integrity_owner_select','notification_outbox_integrity_owner_update')
      and polpermissive and polroles=array['notification_event_trigger'::regrole::oid])<>2 then
    raise exception 'Notification integrity owner policy inventory is invalid';
  end if;
  select count(*) into exact_owner_count from pg_proc
    where proowner='notification_projection_finalizer'::regrole
      and oid=any(array[
        'public.notification_finalize_audience(text)'::regprocedure,
        'public.notification_observe_audience()'::regprocedure,
        'public.notification_projection_commit_guard()'::regprocedure]);
  if exact_owner_count<>3 or (select count(*) from pg_proc
      where proowner='notification_projection_finalizer'::regrole)<>3
    or exists(select 1 from pg_class where relowner='notification_projection_finalizer'::regrole)
    or exists(select 1 from pg_namespace where nspowner='notification_projection_finalizer'::regrole) then
    raise exception 'Notification projection finalizer ownership is invalid';
  end if;
  select count(*) into finalizer_edge_count from pg_auth_members
    where roleid='notification_projection_finalizer'::regrole;
  select count(*) into event_owner_edge_count from pg_auth_members
    where roleid='notification_event_trigger'::regrole;
  select count(*) into app_edge_count from pg_auth_members
    where roleid='app_notification_worker'::regrole;
  if server_major=18 then
    if to_regrole('anon') is null
      or pg_has_role('anon','notification_projection_finalizer','SET')
      or pg_has_role('anon','notification_projection_finalizer','USAGE')
      or pg_has_role('anon','notification_event_trigger','SET')
      or pg_has_role('anon','notification_event_trigger','USAGE')
      or finalizer_edge_count<>0 or event_owner_edge_count<>0 or app_edge_count<>1 or not exists(
      select 1 from pg_auth_members membership
      join pg_roles member_role on member_role.oid=membership.member
      join pg_roles grantor_role on grantor_role.oid=membership.grantor
      where membership.roleid='app_notification_worker'::regrole
        and member_role.rolname=current_user and grantor_role.rolname=current_user
        and not membership.admin_option and membership.inherit_option and membership.set_option
    ) then
      raise exception 'Notification projection finalizer creator edge changed';
    end if;
  elsif server_major=17 and (finalizer_edge_count<>1 or event_owner_edge_count<>1
    or app_edge_count<>2 or not exists(
    select 1 from pg_auth_members membership
    join pg_roles member_role on member_role.oid=membership.member
    join pg_roles grantor_role on grantor_role.oid=membership.grantor
    where membership.roleid='notification_projection_finalizer'::regrole
      and member_role.rolname='postgres' and grantor_role.rolname='supabase_admin'
      and membership.admin_option and not membership.inherit_option and not membership.set_option
  ) or not exists(
    select 1 from pg_auth_members membership
    join pg_roles member_role on member_role.oid=membership.member
    join pg_roles grantor_role on grantor_role.oid=membership.grantor
    where membership.roleid='notification_event_trigger'::regrole
      and member_role.rolname='postgres' and grantor_role.rolname='supabase_admin'
      and membership.admin_option and not membership.inherit_option and not membership.set_option
  ) or not exists(
    select 1 from pg_auth_members membership
    join pg_roles member_role on member_role.oid=membership.member
    join pg_roles grantor_role on grantor_role.oid=membership.grantor
    where membership.roleid='app_notification_worker'::regrole
      and member_role.rolname='postgres' and grantor_role.rolname='postgres'
      and not membership.admin_option and membership.inherit_option and membership.set_option
  ) or not exists(
    select 1 from pg_auth_members membership
    join pg_roles member_role on member_role.oid=membership.member
    join pg_roles grantor_role on grantor_role.oid=membership.grantor
    where membership.roleid='app_notification_worker'::regrole
      and member_role.rolname='postgres' and grantor_role.rolname='supabase_admin'
      and membership.admin_option and not membership.inherit_option and not membership.set_option
  ) or pg_has_role('postgres','notification_projection_finalizer','USAGE')
    or pg_has_role('postgres','notification_projection_finalizer','SET')
    or pg_has_role('postgres','notification_event_trigger','USAGE')
    or pg_has_role('postgres','notification_event_trigger','SET')) then
    raise exception 'Notification projection finalizer creator edge changed';
  elsif server_major not in (17,18) then
    raise exception 'Notification projection requires reviewed PostgreSQL 17 or 18';
  end if;
  drop table pg_temp.notification_projection_persistent_graph;
end $$;

-- Retarget only the ten reviewed PUBLIC policies. ALTER POLICY changes only the
-- role array: command, permissiveness and USING/WITH CHECK expressions stay byte-for-byte catalog
-- equivalents. The actual relation owner is retained explicitly and can never be a Slice5 role.
do $$
declare owner_name text;
begin
  select pg_get_userbyid(relowner) into owner_name from pg_class where oid='public.organizations'::regclass;
  if owner_name in ('app_notification_worker','notification_projection_finalizer') then
    raise exception 'Notification projection source ownership is invalid';
  end if;
  execute format('alter policy organizations_admin_all on public.organizations to anon,authenticated,service_role,%I',owner_name);
  execute format('alter policy organizations_member_select on public.organizations to anon,authenticated,service_role,%I',owner_name);

  select pg_get_userbyid(relowner) into owner_name from pg_class where oid='public.organization_members'::regclass;
  if owner_name in ('app_notification_worker','notification_projection_finalizer') then
    raise exception 'Notification projection source ownership is invalid';
  end if;
  execute format('alter policy organization_members_admin_all on public.organization_members to anon,authenticated,service_role,app_ledger,%I',owner_name);
  execute format('alter policy organization_members_self_select on public.organization_members to anon,authenticated,service_role,app_ledger,%I',owner_name);

  select pg_get_userbyid(relowner) into owner_name from pg_class where oid='public.profiles'::regclass;
  if owner_name in ('app_notification_worker','notification_projection_finalizer') then
    raise exception 'Notification projection source ownership is invalid';
  end if;
  execute format('alter policy profiles_self_select on public.profiles to anon,authenticated,service_role,app_ledger,%I',owner_name);
  execute format('alter policy profiles_self_update on public.profiles to anon,authenticated,service_role,%I',owner_name);

  select pg_get_userbyid(relowner) into owner_name from pg_class where oid='public.permission_rules'::regclass;
  if owner_name in ('app_notification_worker','notification_projection_finalizer') then
    raise exception 'Notification projection source ownership is invalid';
  end if;
  execute format('alter policy permission_rules_org_guc on public.permission_rules to anon,authenticated,service_role,app_ledger,%I',owner_name);

  select pg_get_userbyid(relowner) into owner_name from pg_class where oid='public.join_request'::regclass;
  if owner_name in ('app_notification_worker','notification_projection_finalizer') then
    raise exception 'Notification projection source ownership is invalid';
  end if;
  execute format('alter policy join_request_admin_all on public.join_request to anon,authenticated,service_role,%I',owner_name);
  execute format('alter policy join_request_self_insert on public.join_request to anon,authenticated,service_role,%I',owner_name);
  execute format('alter policy join_request_self_select on public.join_request to anon,authenticated,service_role,%I',owner_name);
end $$;

grant select(id,status) on public.organizations to app_notification_worker;
grant select(organization_id,profile_id,role) on public.organization_members to app_notification_worker;
grant select(id,role) on public.profiles to app_notification_worker;
grant select(org_id,profile_id,role_key) on public.member_roles to app_notification_worker;
grant select(org_id,role_key,module,can_manage,field_level,if_owner)
  on public.permission_rules to app_notification_worker;
grant select(id,organization_id,supabase_id,user_id,status,created_at,reviewed_at)
  on public.join_request to app_notification_worker;

-- One nonrecursive policy per source relation. Every branch derives its subject from the exact
-- live event or immutable projected receipt through notification_projection_source_fence().
create policy notification_projection_organizations_select on public.organizations
  as permissive for select to app_notification_worker
  using(id::text=current_setting('app.current_org_id',true)
    and public.notification_projection_source_fence(id));

create policy notification_projection_organization_members_select on public.organization_members
  as permissive for select to app_notification_worker
  using(organization_id::text=current_setting('app.current_org_id',true)
    and public.notification_projection_source_fence(organization_id));

create policy notification_projection_member_roles_select on public.member_roles
  as permissive for select to app_notification_worker
  using(org_id::text=current_setting('app.current_org_id',true)
    and public.notification_projection_source_fence(org_id));

create policy notification_projection_permission_rules_select on public.permission_rules
  as permissive for select to app_notification_worker
  using(org_id::text=current_setting('app.current_org_id',true) and module='users'
    and public.notification_projection_source_fence(org_id));

create policy notification_projection_join_request_select on public.join_request
  as permissive for select to app_notification_worker
  using(join_request.organization_id=current_setting('app.current_org_id',true)
    and join_request.organization_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.notification_projection_source_fence(join_request.organization_id::uuid)
    and exists(select 1 from public.notification_events e
      where e.organization_id::text=join_request.organization_id and e.subject_type='join_request'
        and e.subject_id=join_request.id));

create policy notification_projection_profiles_select on public.profiles
  as permissive for select to app_notification_worker
  using(public.notification_projection_source_fence(
      case when current_setting('app.current_org_id',true)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.current_org_id',true)::uuid else null::uuid end)
    and (
      exists(select 1 from public.organization_members m
        where m.organization_id::text=current_setting('app.current_org_id',true) and m.profile_id=profiles.id)
      or exists(select 1 from public.join_request j join public.notification_events e
          on e.organization_id::text=j.organization_id and e.subject_type='join_request' and e.subject_id=j.id
        where j.organization_id=current_setting('app.current_org_id',true)
          and j.supabase_id=profiles.id and j.user_id=j.supabase_id::text)
    ));

-- Compare the complete post-adoption source catalog, including every ACL,
-- expression and authority edge, with the frozen preflight plus reviewed delta.
do $$
declare source_policy_count integer;
begin
  if exists((
      select c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity
      from pg_class c where c.oid=any(array[
        'public.organizations'::regclass,'public.organization_members'::regclass,
        'public.profiles'::regclass,'public.member_roles'::regclass,
        'public.permission_rules'::regclass,'public.join_request'::regclass])
      except select * from pg_temp.notification_projection_source_relation_before
    )) or exists((select * from pg_temp.notification_projection_source_relation_before)
      except (
        select c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity
        from pg_class c where c.oid=any(array[
          'public.organizations'::regclass,'public.organization_members'::regclass,
          'public.profiles'::regclass,'public.member_roles'::regclass,
          'public.permission_rules'::regclass,'public.join_request'::regclass])
      )) then raise exception 'Notification projection source relation catalog changed'; end if;

  if exists((
      select c.relname,
        case when acl.grantee=0 then 'PUBLIC'
          when acl.grantee=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantee) end,
        case when acl.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantor) end,
        acl.privilege_type,acl.is_grantable
      from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      where c.oid=any(array[
        'public.organizations'::regclass,'public.organization_members'::regclass,
        'public.profiles'::regclass,'public.member_roles'::regclass,
        'public.permission_rules'::regclass,'public.join_request'::regclass])
      except select * from pg_temp.notification_projection_source_table_acl_before
    )) or exists((select * from pg_temp.notification_projection_source_table_acl_before)
      except (
        select c.relname,
          case when acl.grantee=0 then 'PUBLIC'
            when acl.grantee=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantee) end,
          case when acl.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantor) end,
          acl.privilege_type,acl.is_grantable
        from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        where c.oid=any(array[
          'public.organizations'::regclass,'public.organization_members'::regclass,
          'public.profiles'::regclass,'public.member_roles'::regclass,
          'public.permission_rules'::regclass,'public.join_request'::regclass])
      )) then raise exception 'Notification projection source table ACL changed'; end if;

  create temporary table notification_projection_expected_source_column_acl (
    relname text not null,attname text not null,grantee text not null,grantor text not null,
    privilege_type text not null,is_grantable boolean not null,primary key(relname,attname)
  ) on commit drop;
  insert into notification_projection_expected_source_column_acl
  select relation_name,column_name,'app_notification_worker','RELATION_OWNER','SELECT',false
  from (values
    ('organizations',array['id','status']::text[]),
    ('organization_members',array['organization_id','profile_id','role']::text[]),
    ('profiles',array['id','role']::text[]),
    ('member_roles',array['org_id','profile_id','role_key']::text[]),
    ('permission_rules',array['org_id','role_key','module','can_manage','field_level','if_owner']::text[]),
    ('join_request',array['id','organization_id','supabase_id','user_id','status','created_at','reviewed_at']::text[])
  ) expected(relation_name,column_names)
  cross join lateral unnest(expected.column_names) column_name;
  create temporary table notification_projection_source_column_acl_after on commit drop as
  select c.relname,attribute.attname,
    case when acl.grantee=0 then 'PUBLIC'
      when acl.grantee=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantee) end as grantee,
    case when acl.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(acl.grantor) end as grantor,
    acl.privilege_type,acl.is_grantable
  from pg_class c join pg_attribute attribute on attribute.attrelid=c.oid
  cross join lateral aclexplode(attribute.attacl) acl
  where c.oid=any(array[
    'public.organizations'::regclass,'public.organization_members'::regclass,
    'public.profiles'::regclass,'public.member_roles'::regclass,
    'public.permission_rules'::regclass,'public.join_request'::regclass])
    and attribute.attnum>0 and not attribute.attisdropped;
  if exists((select * from notification_projection_source_column_acl_after)
      except (select * from notification_projection_expected_source_column_acl))
    or exists((select * from notification_projection_expected_source_column_acl)
      except (select * from notification_projection_source_column_acl_after)) then
    raise exception 'Notification projection source column ACL changed';
  end if;

  create temporary table notification_projection_source_policy_after on commit drop as
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
  if exists((select * from notification_projection_source_policy_after)
      except (select * from notification_projection_expected_source_policy_after))
    or exists((select * from notification_projection_expected_source_policy_after)
      except (select * from notification_projection_source_policy_after)) then
    raise exception 'Notification projection source policy installation changed';
  end if;

  if exists((
      select target.rolname,member.rolname,grantor.rolname,
        membership.admin_option,membership.inherit_option,membership.set_option
      from pg_auth_members membership
      join pg_roles target on target.oid=membership.roleid
      join pg_roles member on member.oid=membership.member
      join pg_roles grantor on grantor.oid=membership.grantor
      where target.rolname=any(array['anon','authenticated','service_role','app_ledger',current_user])
      except select * from pg_temp.notification_projection_source_edges_before
    )) or exists((select * from pg_temp.notification_projection_source_edges_before)
      except (
        select target.rolname,member.rolname,grantor.rolname,
          membership.admin_option,membership.inherit_option,membership.set_option
        from pg_auth_members membership
        join pg_roles target on target.oid=membership.roleid
        join pg_roles member on member.oid=membership.member
        join pg_roles grantor on grantor.oid=membership.grantor
        where target.rolname=any(array['anon','authenticated','service_role','app_ledger',current_user])
      )) then raise exception 'Notification projection source role graph changed'; end if;

  if exists((
      select source.rolname,target.authority_role,mode.mode
      from pg_roles source
      cross join (values('anon'),('authenticated'),('service_role'),('app_ledger'),(current_user))
        target(authority_role)
      cross join (values('MEMBER'),('USAGE'),('SET')) mode(mode)
      where not source.rolsuper and pg_has_role(source.oid,to_regrole(target.authority_role),mode.mode)
      except select * from pg_temp.notification_projection_source_reachability_before
    )) or exists((select * from pg_temp.notification_projection_source_reachability_before)
      except (
        select source.rolname,target.authority_role,mode.mode
        from pg_roles source
        cross join (values('anon'),('authenticated'),('service_role'),('app_ledger'),(current_user))
          target(authority_role)
        cross join (values('MEMBER'),('USAGE'),('SET')) mode(mode)
        where not source.rolsuper and pg_has_role(source.oid,to_regrole(target.authority_role),mode.mode)
      )) then raise exception 'Notification projection source role reachability changed'; end if;

  select count(*) into source_policy_count from pg_policy p
    where p.polrelid=any(array[
      'public.organizations'::regclass,'public.organization_members'::regclass,
      'public.profiles'::regclass,'public.member_roles'::regclass,
      'public.permission_rules'::regclass,'public.join_request'::regclass])
      and p.polname like 'notification_projection_%_select'
      and p.polroles=array['app_notification_worker'::regrole::oid]
      and p.polpermissive and p.polcmd='r';
  if source_policy_count<>6 then
    raise exception 'Notification projection source policy installation is incomplete';
  end if;
end $$;
