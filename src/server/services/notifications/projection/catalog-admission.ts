import type postgres from 'postgres';
import { getRlsPgClient } from '$server/db/pg-pool';
import { notificationProjectionCatalogMatches } from './catalog-fingerprint';

type CatalogRow = Readonly<{ snapshot: unknown }>;

/** One fixed catalog statement captures every authority field in one snapshot. */
export async function readNotificationProjectionCatalog(
  tx: postgres.TransactionSql,
): Promise<unknown> {
  const rows = await tx<CatalogRow[]>`
    with source_names(relname) as (values
      ('organizations'),('organization_members'),('profiles'),('member_roles'),
      ('permission_rules'),('join_request')
    ), operational_names(relname) as (values
      ('notification_worker_runtime'),('notification_org_control'),('notification_outbox'),
      ('notification_events'),('notification_projection_receipts'),
      ('notification_audience_candidates')
    ), source_relations as (
      select c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity
      from source_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
    ), operational_relations as (
      select c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity
      from operational_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
    ), table_acl_rows as (
      select c.relname,
        case when a.grantee=0 then 'PUBLIC' when a.grantee=c.relowner then 'RELATION_OWNER'
          else pg_get_userbyid(a.grantee) end grantee,
        a.privilege_type,a.is_grantable,
        case when a.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(a.grantor) end grantor
      from source_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    ), table_acl as (
      select relname,grantee,grantor,is_grantable,
        array_agg(privilege_type order by privilege_type) privileges
      from table_acl_rows group by relname,grantee,grantor,is_grantable
    ), operational_table_acl_rows as (
      select c.relname,
        case when a.grantee=0 then 'PUBLIC' when a.grantee=c.relowner then 'RELATION_OWNER'
          else pg_get_userbyid(a.grantee) end grantee,
        a.privilege_type,a.is_grantable,
        case when a.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(a.grantor) end grantor
      from operational_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    ), operational_table_acl as (
      select relname,grantee,grantor,is_grantable,
        array_agg(privilege_type order by privilege_type) privileges
      from operational_table_acl_rows group by relname,grantee,grantor,is_grantable
    ), column_acl_rows as (
      select c.relname,att.attname,
        case when a.grantee=0 then 'PUBLIC' when a.grantee=c.relowner then 'RELATION_OWNER'
          else pg_get_userbyid(a.grantee) end grantee,
        a.privilege_type,a.is_grantable,
        case when a.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(a.grantor) end grantor
      from source_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
      join pg_attribute att on att.attrelid=c.oid and att.attnum>0 and not att.attisdropped
      cross join lateral aclexplode(att.attacl) a
    ), operational_column_acl_rows as (
      select c.relname,att.attname,
        case when a.grantee=0 then 'PUBLIC' when a.grantee=c.relowner then 'RELATION_OWNER'
          else pg_get_userbyid(a.grantee) end grantee,
        a.privilege_type,a.is_grantable,
        case when a.grantor=c.relowner then 'RELATION_OWNER' else pg_get_userbyid(a.grantor) end grantor
      from operational_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
      join pg_attribute att on att.attrelid=c.oid and att.attnum>0 and not att.attisdropped
      cross join lateral aclexplode(att.attacl) a
    ), source_authority_targets as (
      select distinct case when grantee='RELATION_OWNER' then session_user else grantee end role_name
      from (
        select grantee from table_acl_rows
        union all
        select grantee from column_acl_rows
      ) acl where grantee<>'PUBLIC'
    ), source_owner_edges as (
      select target.rolname target,member.rolname member,grantor.rolname grantor,
        m.admin_option,m.inherit_option,m.set_option
      from pg_auth_members m join pg_roles target on target.oid=m.roleid
      join pg_roles member on member.oid=m.member join pg_roles grantor on grantor.oid=m.grantor
      where target.rolname in (select role_name from source_authority_targets)
    ), source_reachability as (
      select source.rolname source,target.role_name target,mode.mode
      from pg_roles source cross join source_authority_targets target
      cross join (values('MEMBER'),('USAGE'),('SET')) mode(mode)
      where not source.rolsuper and pg_has_role(source.oid,to_regrole(target.role_name),mode.mode)
    ), source_policies as (
      select c.relname,p.polname,p.polcmd,p.polpermissive,
        array(select case when role_oid=0 then 'PUBLIC' when role_oid=c.relowner then 'RELATION_OWNER'
          else pg_get_userbyid(role_oid) end
          from unnest(p.polroles) role_oid order by 1) roles,
        pg_get_expr(p.polqual,p.polrelid,true) qual,
        pg_get_expr(p.polwithcheck,p.polrelid,true) with_check
      from source_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
      join pg_policy p on p.polrelid=c.oid
    ), operational_policies as (
      select c.relname,p.polname,p.polcmd,p.polpermissive,
        array(select case when role_oid=0 then 'PUBLIC' when role_oid=c.relowner then 'RELATION_OWNER'
          else pg_get_userbyid(role_oid) end
          from unnest(p.polroles) role_oid order by 1) roles,
        pg_get_expr(p.polqual,p.polrelid,true) qual,
        pg_get_expr(p.polwithcheck,p.polrelid,true) with_check
      from operational_names t join pg_class c on c.oid=format('public.%I',t.relname)::regclass
      join pg_policy p on p.polrelid=c.oid
    ), session_role as (
      select rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
      from pg_roles where rolname=session_user
    ), slice_roles as (
      select rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
      from pg_roles where rolname in (
        'app_notification_worker','notification_event_trigger','notification_projection_finalizer')
    ), owner_edges as (
      select target.rolname target,member.rolname member,grantor.rolname grantor,
        m.admin_option,m.inherit_option,m.set_option
      from pg_auth_members m join pg_roles target on target.oid=m.roleid
      join pg_roles member on member.oid=m.member join pg_roles grantor on grantor.oid=m.grantor
      where target.rolname in ('app_notification_worker','notification_event_trigger',
          'notification_projection_finalizer')
        or member.rolname in ('app_notification_worker','notification_event_trigger',
          'notification_projection_finalizer')
    ), reachability as (
      select source.rolname source,target.target,mode.mode
      from pg_roles source
      cross join (values('app_notification_worker'),('notification_event_trigger'),
        ('notification_projection_finalizer')) target(target)
      cross join (values('MEMBER'),('USAGE'),('SET')) mode(mode)
      where not source.rolsuper and pg_has_role(source.oid,to_regrole(target.target),mode.mode)
    ), functions as (
      select p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
        pg_get_function_result(p.oid) result_type,p.prosrc,
        coalesce((select jsonb_agg(jsonb_build_object(
          'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
          'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,
          'grantable',a.is_grantable)
          order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
            a.privilege_type)
          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb) acl
      from pg_proc p where p.oid=any(array[
        'public.notification_event_enqueue()'::regprocedure,
        'public.notification_quarantine_claims(jsonb)'::regprocedure,
        'public.notification_finalize_audience(text)'::regprocedure,
        'public.notification_observe_audience()'::regprocedure,
        'public.notification_projection_commit_guard()'::regprocedure])
    ), guard_trigger as (
      select t.tgname,t.tgdeferrable,t.tginitdeferred,t.tgenabled,
        t.tgfoid::regprocedure::text function_signature,pg_get_triggerdef(t.oid,true) definition
      from pg_trigger t where t.tgrelid='public.notification_projection_receipts'::regclass
        and t.tgname='notification_projection_receipt_commit_guard' and not t.tgisinternal
    )
    select jsonb_build_object(
      'serverMajor',current_setting('server_version_num')::integer/10000,
      'sessionUser',session_user,
      'sessionRole',(select to_jsonb(x) from session_role x),
      'sourceRelations',(select jsonb_agg(to_jsonb(x) order by relname) from source_relations x),
      'operationalRelations',(select jsonb_agg(to_jsonb(x) order by relname) from operational_relations x),
      'tableAcl',(select jsonb_agg(to_jsonb(x) order by relname,grantee,grantor) from table_acl x),
      'operationalTableAcl',(select jsonb_agg(to_jsonb(x) order by relname,grantee,grantor)
        from operational_table_acl x),
      'columnAcl',coalesce((select jsonb_agg(to_jsonb(x)
        order by relname,attname,grantee,grantor,privilege_type) from column_acl_rows x),'[]'::jsonb),
      'operationalColumnAcl',coalesce((select jsonb_agg(to_jsonb(x)
        order by relname,attname,grantee,grantor,privilege_type)
        from operational_column_acl_rows x),'[]'::jsonb),
      'sourcePolicies',(select jsonb_agg(to_jsonb(x) order by relname,polname) from source_policies x),
      'operationalPolicies',(select jsonb_agg(to_jsonb(x) order by relname,polname)
        from operational_policies x),
      'sourceOwnerEdges',coalesce((select jsonb_agg(to_jsonb(x)
        order by target,member,grantor) from source_owner_edges x),'[]'::jsonb),
      'sourceReachability',coalesce((select jsonb_agg(to_jsonb(x)
        order by source,target,mode) from source_reachability x),'[]'::jsonb),
      'sliceRoles',(select jsonb_agg(to_jsonb(x) order by rolname) from slice_roles x),
      'ownerEdges',coalesce((select jsonb_agg(to_jsonb(x)
        order by target,member,grantor) from owner_edges x),'[]'::jsonb),
      'reachability',coalesce((select jsonb_agg(to_jsonb(x)
        order by source,target,mode) from reachability x),'[]'::jsonb),
      'functions',(select jsonb_agg(to_jsonb(x) order by signature) from functions x),
      'guardTrigger',(select to_jsonb(x) from guard_trigger x)
    ) as snapshot`;
  if (rows.length !== 1) throw new Error('Notification projection catalog is unavailable');
  return rows[0]?.snapshot;
}

/** Fails closed before runtime-lease acquisition when any reviewed catalog field drifts. */
export async function admitNotificationProjectionCatalog(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  const accepted = await getRlsPgClient().begin(async (tx) => {
    await tx`select set_config('statement_timeout','3s',true),
      set_config('lock_timeout','250ms',true),
      set_config('idle_in_transaction_session_timeout','5s',true)`;
    if (signal.aborted) return false;
    const snapshot = await readNotificationProjectionCatalog(tx);
    if (signal.aborted) return false;
    return notificationProjectionCatalogMatches(snapshot);
  });
  return accepted === true;
}
