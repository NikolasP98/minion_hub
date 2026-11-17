-- F7 (minion-meta spec 128): bounded operator authority bridge.
-- One fixed SECURITY DEFINER projection so a verified operator can read the exact
-- authority rows (org status, membership, roles, permission rules) under the real
-- app_ledger ACL, which has no SELECT on organizations and no UPDATE (row-lock) grants.
-- No table grant/policy changes. EXECUTE only to app_ledger. Rollback: DROP FUNCTION only.

do $preflight$
declare
  owners text[];
  v_owner text;
  v_forced int;
  v_bypass boolean;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_ledger') then
    raise exception 'operator authority bridge: role app_ledger is missing';
  end if;
  select pg_catalog.array_agg(distinct pg_catalog.pg_get_userbyid(c.relowner)) into owners
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('organizations','profiles','organization_members','member_roles','org_roles','permission_rules');
  if owners is null or pg_catalog.cardinality(owners) <> 1
     or (select pg_catalog.count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p')
            and c.relname in ('organizations','profiles','organization_members','member_roles','org_roles','permission_rules')) <> 6 then
    raise exception 'operator authority bridge: the six authority tables need one common owner';
  end if;
  v_owner := owners[1];
  if v_owner in ('app_ledger','anon','authenticated','service_role','app_assistant_ro','public') then
    raise exception 'operator authority bridge: untrusted table owner %', v_owner;
  end if;
  select pg_catalog.count(*) into v_forced
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relforcerowsecurity
     and c.relname in ('organizations','profiles','organization_members','member_roles','org_roles','permission_rules');
  select r.rolsuper or r.rolbypassrls into v_bypass from pg_catalog.pg_roles r where r.rolname = v_owner;
  if v_forced > 0 and not v_bypass then
    raise exception 'operator authority bridge: owner % cannot bypass FORCE ROW LEVEL SECURITY', v_owner;
  end if;
  -- No browser/worker role may reach app_ledger through membership.
  if exists (
    select 1 from pg_catalog.pg_auth_members m
      join pg_catalog.pg_roles g on g.oid = m.roleid and g.rolname = 'app_ledger'
      join pg_catalog.pg_roles u on u.oid = m.member
     where u.rolname in ('anon','authenticated','service_role','app_assistant_ro')
  ) then
    raise exception 'operator authority bridge: an untrusted role is a member of app_ledger';
  end if;
end
$preflight$;

create function public.minion_operator_authority_v1(p_org uuid, p_profile uuid, p_lock_rows boolean)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog
set timezone = 'UTC'
as $fn$
declare
  v_model text;
  v_default text;
  v_member_role text;
  v_assigned text[];
  v_local text[];
  v_rules jsonb;
  v_rows jsonb;
  v_n int;
  v_result jsonb;
begin
  if p_org is null or p_profile is null or p_lock_rows is null
     or pg_catalog.lower(coalesce(pg_catalog.current_setting('app.current_org_id', true), '')) <> p_org::text
     or pg_catalog.lower(coalesce(pg_catalog.current_setting('app.current_profile_id', true), '')) <> p_profile::text then
    raise exception 'operator_scope_invalid' using errcode = '42501';
  end if;

  if p_lock_rows then
    if pg_catalog.current_setting('transaction_read_only') <> 'off' then
      raise exception 'operator_scope_invalid' using errcode = '42501';
    end if;
    -- stock-v1 key first, then the org authority lock (112); never the profile lock (114).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('minion:stock-write:v1:' || p_org::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text, 112));
  elsif pg_catalog.current_setting('transaction_read_only') <> 'on'
     or pg_catalog.current_setting('transaction_isolation') <> 'repeatable read' then
    raise exception 'operator_scope_invalid' using errcode = '42501';
  end if;

  -- Locked mode takes FOR SHARE in the fixed order organizations -> profiles -> membership.
  if p_lock_rows then
    perform 1 from public.organizations o where o.id = p_org and o.status = 'active' for share;
  else
    perform 1 from public.organizations o where o.id = p_org and o.status = 'active';
  end if;
  if not found then raise exception 'operator_principal_inactive' using errcode = '42501'; end if;

  if p_lock_rows then
    perform 1 from public.profiles p where p.id = p_profile
      and not coalesce((pg_catalog.to_jsonb(p)->>'deletion_pending')::boolean, false) for share;
  else
    perform 1 from public.profiles p where p.id = p_profile
      and not coalesce((pg_catalog.to_jsonb(p)->>'deletion_pending')::boolean, false);
  end if;
  if not found then raise exception 'operator_principal_inactive' using errcode = '42501'; end if;

  if p_lock_rows then
    select m.role into v_member_role from public.organization_members m
     where m.organization_id = p_org and m.profile_id = p_profile for share;
  else
    select m.role into v_member_role from public.organization_members m
     where m.organization_id = p_org and m.profile_id = p_profile;
  end if;
  if not found then raise exception 'operator_principal_inactive' using errcode = '42501'; end if;

  select pg_catalog.to_jsonb(o)->>'role_model', pg_catalog.to_jsonb(o)->>'default_role_key'
    into v_model, v_default from public.organizations o where o.id = p_org;

  -- Bounds are counted before aggregating; limit+1 or an oversize key fails with no truncation.
  select pg_catalog.count(*) into v_n from public.member_roles r where r.org_id = p_org and r.profile_id = p_profile;
  if v_n > 128 then raise exception 'operator_authority_limit' using errcode = '54000'; end if;
  select pg_catalog.count(*) into v_n from public.org_roles r where r.org_id = p_org::text;
  if v_n > 128 then raise exception 'operator_authority_limit' using errcode = '54000'; end if;
  select pg_catalog.count(*) into v_n from public.permission_rules r where r.org_id = p_org;
  if v_n > 10000 then raise exception 'operator_authority_limit' using errcode = '54000'; end if;
  if exists (select 1 from public.member_roles r where r.org_id = p_org and r.profile_id = p_profile and pg_catalog.octet_length(r.role_key) > 256)
     or exists (select 1 from public.org_roles r where r.org_id = p_org::text and pg_catalog.octet_length(r.key) > 256)
     or exists (select 1 from public.permission_rules r where r.org_id = p_org and (pg_catalog.octet_length(r.role_key) > 256 or pg_catalog.octet_length(r.module) > 256)) then
    raise exception 'operator_authority_limit' using errcode = '54000';
  end if;

  if p_lock_rows then
    perform 1 from public.member_roles r where r.org_id = p_org and r.profile_id = p_profile order by r.role_key collate "C" for share;
    perform 1 from public.org_roles r where r.org_id = p_org::text order by r.key collate "C" for share;
    perform 1 from public.permission_rules r where r.org_id = p_org order by r.role_key collate "C", r.module collate "C" for share;
  end if;

  -- Duplicate logical keys fail rather than choose an arbitrary row.
  if exists (select 1 from public.member_roles r where r.org_id = p_org and r.profile_id = p_profile group by r.role_key having pg_catalog.count(*) > 1)
     or exists (select 1 from public.org_roles r where r.org_id = p_org::text group by r.key having pg_catalog.count(*) > 1)
     or exists (select 1 from public.permission_rules r where r.org_id = p_org group by r.role_key, r.module having pg_catalog.count(*) > 1) then
    raise exception 'operator_authority_inconsistent' using errcode = '55000';
  end if;

  select coalesce(pg_catalog.array_agg(r.role_key order by r.role_key collate "C"), '{}'::text[]) into v_assigned
    from public.member_roles r where r.org_id = p_org and r.profile_id = p_profile;
  select coalesce(pg_catalog.array_agg(r.key order by r.key collate "C"), '{}'::text[]) into v_local
    from public.org_roles r where r.org_id = p_org::text;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role_key', r.role_key, 'module', r.module,
      'can_view', r.can_view, 'can_create', r.can_create, 'can_edit', r.can_edit,
      'can_delete', r.can_delete, 'can_export', r.can_export, 'can_manage', r.can_manage,
      'if_owner', r.if_owner, 'field_level', r.field_level)
    order by r.role_key collate "C", r.module collate "C"), '[]'::jsonb) into v_rules
    from public.permission_rules r where r.org_id = p_org;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table', t.tbl, 'key', pg_catalog.to_jsonb(t.k), 'rowHash', t.h)
      order by t.tbl collate "C", pg_catalog.array_to_string(t.k, E'\x1f') collate "C"), '[]'::jsonb) into v_rows
    from (
      select 'organizations'::text as tbl, array[o.id::text] as k,
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(o)::text, 'UTF8')), 'hex') as h
        from public.organizations o where o.id = p_org
      union all
      select 'profiles', array[p.id::text],
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(p)::text, 'UTF8')), 'hex')
        from public.profiles p where p.id = p_profile
      union all
      select 'organization_members', array[m.organization_id::text, m.profile_id::text],
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(m)::text, 'UTF8')), 'hex')
        from public.organization_members m where m.organization_id = p_org and m.profile_id = p_profile
      union all
      select 'member_roles', array[r.org_id::text, r.profile_id::text, r.role_key],
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(r)::text, 'UTF8')), 'hex')
        from public.member_roles r where r.org_id = p_org and r.profile_id = p_profile
      union all
      select 'org_roles', array[r.org_id, r.key],
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(r)::text, 'UTF8')), 'hex')
        from public.org_roles r where r.org_id = p_org::text
      union all
      select 'permission_rules', array[r.org_id::text, r.role_key, r.module],
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(r)::text, 'UTF8')), 'hex')
        from public.permission_rules r where r.org_id = p_org
    ) t;

  v_result := pg_catalog.jsonb_build_object(
    'version', 1,
    'orgId', p_org::text,
    'profileId', p_profile::text,
    'organizationStatus', 'active',
    'deletionPending', false,
    'roleModel', v_model,
    'defaultRoleKey', v_default,
    'membershipRole', v_member_role,
    'assignedRoleKeys', pg_catalog.to_jsonb(v_assigned),
    'localRoleKeys', pg_catalog.to_jsonb(v_local),
    'rules', v_rules,
    'authorityRows', v_rows);
  if pg_catalog.octet_length(v_result::text) > 2097152 then
    raise exception 'operator_authority_limit' using errcode = '54000';
  end if;
  return v_result;
end
$fn$;

-- Ownership, ACL: one atomic migration transaction, no public-execute window.
do $acl$
declare
  v_owner text;
  v_grantee text;
begin
  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'organizations';
  if v_owner is distinct from (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
      where p.oid = 'public.minion_operator_authority_v1(uuid,uuid,boolean)'::pg_catalog.regprocedure) then
    execute pg_catalog.format('alter function public.minion_operator_authority_v1(uuid,uuid,boolean) owner to %I', v_owner);
  end if;
  revoke all on function public.minion_operator_authority_v1(uuid,uuid,boolean) from public;
  for v_grantee in
    select pg_catalog.pg_get_userbyid(a.grantee)
      from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'public.minion_operator_authority_v1(uuid,uuid,boolean)'::pg_catalog.regprocedure
       and a.grantee <> 0 and a.grantee <> p.proowner
       and pg_catalog.pg_get_userbyid(a.grantee) <> 'app_ledger'
  loop
    execute pg_catalog.format('revoke all on function public.minion_operator_authority_v1(uuid,uuid,boolean) from %I', v_grantee);
  end loop;
  grant execute on function public.minion_operator_authority_v1(uuid,uuid,boolean) to app_ledger;
end
$acl$;

comment on function public.minion_operator_authority_v1(uuid,uuid,boolean) is
  'Fixed read/lock projection of one operator''s authority rows (minion-meta spec 128). EXECUTE: app_ledger only.';
