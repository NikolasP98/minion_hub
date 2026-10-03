-- Reconcile the four historical notification/reminder tables into Hub's owned
-- migration ledger without pretending the four meta-repo migrations ran here.
--
-- Frozen historical sources (minion-meta path @ source commit, SHA-256):
-- 20260618120000_scheduling_reminders.sql @ 5c9aca53bbb70ea851e16d9201c6220f457585c1
--   322507dae7c53e2b20a18380942f92bd26cdc4577a4e6b8449362a29431dadd1
-- 20260621200000_sched_reminders_multichannel.sql @ 104476e3593a01dc457df47335736a3c0ff51d10
--   9e88e5b2a17aefef527d4b7ff990ef731db373f5d75707886fe7e5a72620b7dd
-- 20260621220000_sched_reminder_infer_confirmation.sql @ e4de92efafe52e826cb26449e4784c5a254ba9ca
--   7e329877bc7b7a71d7c416e233fc1d0f7f99bb66ae0cd8d7df1ee8f009ea1848
-- 20260622230000_notifications.sql @ 2b0a88b6dc297d32072e40339aece2086a2070bc
--   823e656662d5e3bc69888dbad39b5f752f6b107bb7dc0ccccb40376d5baed172

-- Helper objects are connection-local and disappear at transaction commit.
-- They let both classifier and final assertion compare complete catalog
-- projections instead of relying on CREATE IF NOT EXISTS.
create temporary table notification_reconciliation_scope (
  state text not null,
  owner_name text not null
) on commit drop;

create function pg_temp.notification_columns(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(
      format(
        '%s|%s|%s|%s|%s|%s',
        a.attname,
        format_type(a.atttypid, a.atttypmod),
        case when a.attnotnull then 'notnull' else 'nullable' end,
        a.attidentity,
        a.attgenerated,
        coalesce(pg_get_expr(d.adbin, d.adrelid, true), '<NULL>')
      ) order by a.attnum
    ),
    array[]::text[]
  )
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = target and a.attnum > 0 and not a.attisdropped
$$;

create function pg_temp.notification_constraints(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(
      format(
        '%s|%s|%s|%s|%s|%s',
        c.conname,
        c.contype,
        pg_get_constraintdef(c.oid, true),
        c.convalidated,
        c.condeferrable,
        c.condeferred
      ) order by c.conname
    ),
    array[]::text[]
  )
  from pg_constraint c
  where c.conrelid = target
$$;

-- PostgreSQL 18 promotes NOT NULL attributes into pg_constraint (contype=n);
-- older supported servers do not. The column manifest above fixes the exact
-- attributes, while this projection fixes the corresponding PG18 constraint
-- names and definitions without making the migration server-version-specific.
create function pg_temp.notification_expected_not_null_constraints(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select case when current_setting('server_version_num')::integer < 180000
    then array[]::text[]
    else coalesce(
      array_agg(
        format(
          '%s_%s_not_null|n|NOT NULL %I|t|f|f',
          c.relname,
          a.attname,
          a.attname
        ) order by format('%s_%s_not_null', c.relname, a.attname)
      ),
      array[]::text[]
    )
  end
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid
  where c.oid = target and a.attnum > 0 and not a.attisdropped and a.attnotnull
$$;

create function pg_temp.notification_sorted(items text[])
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(item order by item), array[]::text[])
  from unnest(items) item
$$;

create function pg_temp.notification_expected_owner_privileges(owner_name text)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select pg_temp.notification_sorted(
    array[
      format('DELETE|%s|f', owner_name),
      format('INSERT|%s|f', owner_name),
      format('REFERENCES|%s|f', owner_name),
      format('SELECT|%s|f', owner_name),
      format('TRIGGER|%s|f', owner_name),
      format('TRUNCATE|%s|f', owner_name),
      format('UPDATE|%s|f', owner_name)
    ]::text[]
    || case when current_setting('server_version_num')::integer >= 180000
      then array[format('MAINTAIN|%s|f', owner_name)]
      else array[]::text[]
    end
  )
$$;

create function pg_temp.notification_final_columns(target_name text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case target_name
    when 'sched_reminder_config' then array[
      $e$org_id|text|notnull|||<NULL>$e$,
      $e$enabled|boolean|notnull|||false$e$,
      $e$stages|jsonb|notnull|||'[{"key": "confirmation"}, {"key": "24h", "minutesBefore": 1440}, {"key": "2h", "minutesBefore": 120}]'::jsonb$e$,
      $e$channel|text|notnull|||'whatsapp'::text$e$,
      $e$account_id|text|nullable|||<NULL>$e$,
      $e$personalize|boolean|notnull|||true$e$,
      $e$locale|text|notnull|||'es'::text$e$,
      $e$from_name|text|nullable|||<NULL>$e$,
      $e$updated_at|timestamp with time zone|notnull|||now()$e$,
      $e$channels|jsonb|notnull|||'[]'::jsonb$e$,
      $e$infer_confirmation|boolean|notnull|||false$e$
    ]::text[]
    when 'sched_reminders' then array[
      $e$id|uuid|notnull|||gen_random_uuid()$e$,
      $e$org_id|text|notnull|||<NULL>$e$,
      $e$booking_id|uuid|notnull|||<NULL>$e$,
      $e$stage|text|notnull|||<NULL>$e$,
      $e$channel|text|notnull|||<NULL>$e$,
      $e$recipient|text|nullable|||<NULL>$e$,
      $e$content|text|nullable|||<NULL>$e$,
      $e$status|text|notnull|||<NULL>$e$,
      $e$message_id|text|nullable|||<NULL>$e$,
      $e$error|text|nullable|||<NULL>$e$,
      $e$sent_at|timestamp with time zone|nullable|||<NULL>$e$,
      $e$created_at|timestamp with time zone|notnull|||now()$e$,
      $e$recipient_role|text|notnull|||'client'::text$e$
    ]::text[]
    when 'notif_rules' then array[
      $e$id|uuid|notnull|||gen_random_uuid()$e$,
      $e$org_id|text|notnull|||<NULL>$e$,
      $e$name|text|notnull|||<NULL>$e$,
      $e$enabled|boolean|notnull|||true$e$,
      $e$trigger_table|text|notnull|||<NULL>$e$,
      $e$trigger_event|text|notnull|||<NULL>$e$,
      $e$date_field|text|nullable|||<NULL>$e$,
      $e$date_offset_mins|integer|nullable|||<NULL>$e$,
      $e$condition|jsonb|notnull|||'[]'::jsonb$e$,
      $e$recipients|jsonb|notnull|||'[]'::jsonb$e$,
      $e$channel|text|notnull|||<NULL>$e$,
      $e$account_id|text|nullable|||<NULL>$e$,
      $e$template|text|notnull|||<NULL>$e$,
      $e$last_run_at|timestamp with time zone|nullable|||<NULL>$e$,
      $e$created_at|timestamp with time zone|notnull|||now()$e$,
      $e$updated_at|timestamp with time zone|notnull|||now()$e$
    ]::text[]
    when 'notif_log' then array[
      $e$id|uuid|notnull|||gen_random_uuid()$e$,
      $e$org_id|text|notnull|||<NULL>$e$,
      $e$rule_id|uuid|notnull|||<NULL>$e$,
      $e$entity_id|text|notnull|||<NULL>$e$,
      $e$trigger_key|text|notnull|||<NULL>$e$,
      $e$channel|text|notnull|||<NULL>$e$,
      $e$recipient|text|nullable|||<NULL>$e$,
      $e$content|text|nullable|||<NULL>$e$,
      $e$status|text|notnull|||<NULL>$e$,
      $e$error|text|nullable|||<NULL>$e$,
      $e$message_id|text|nullable|||<NULL>$e$,
      $e$created_at|timestamp with time zone|notnull|||now()$e$
    ]::text[]
    else null::text[]
  end
$$;

create function pg_temp.notification_final_indexes(target_name text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case target_name
    when 'sched_reminder_config' then array[
      'sched_reminder_config_pkey|CREATE UNIQUE INDEX sched_reminder_config_pkey ON public.sched_reminder_config USING btree (org_id)'
    ]::text[]
    when 'sched_reminders' then array[
      'sched_reminders_booking_idx|CREATE INDEX sched_reminders_booking_idx ON public.sched_reminders USING btree (booking_id)',
      'sched_reminders_booking_stage_chan_uniq|CREATE UNIQUE INDEX sched_reminders_booking_stage_chan_uniq ON public.sched_reminders USING btree (org_id, booking_id, stage, channel, recipient_role)',
      'sched_reminders_org_created_idx|CREATE INDEX sched_reminders_org_created_idx ON public.sched_reminders USING btree (org_id, created_at)',
      'sched_reminders_pkey|CREATE UNIQUE INDEX sched_reminders_pkey ON public.sched_reminders USING btree (id)'
    ]::text[]
    when 'notif_rules' then array[
      'notif_rules_org_idx|CREATE INDEX notif_rules_org_idx ON public.notif_rules USING btree (org_id)',
      'notif_rules_pkey|CREATE UNIQUE INDEX notif_rules_pkey ON public.notif_rules USING btree (id)'
    ]::text[]
    when 'notif_log' then array[
      'notif_log_org_idx|CREATE INDEX notif_log_org_idx ON public.notif_log USING btree (org_id, created_at)',
      'notif_log_pkey|CREATE UNIQUE INDEX notif_log_pkey ON public.notif_log USING btree (id)',
      'notif_log_rule_entity_key_uniq|CREATE UNIQUE INDEX notif_log_rule_entity_key_uniq ON public.notif_log USING btree (rule_id, entity_id, trigger_key)'
    ]::text[]
    else null::text[]
  end
$$;

create function pg_temp.notification_indexes(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(format('%s|%s', ci.relname, pg_get_indexdef(i.indexrelid, 0, true)) order by ci.relname),
    array[]::text[]
  )
  from pg_index i
  join pg_class ci on ci.oid = i.indexrelid
  where i.indrelid = target
$$;

create function pg_temp.notification_policies(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(
      format(
        '%s|%s|%s|%s|%s|%s',
        p.polname,
        p.polcmd,
        p.polpermissive,
        (
          select string_agg(case when role_oid = 0 then 'PUBLIC' else pg_get_userbyid(role_oid) end, ',' order by case when role_oid = 0 then 'PUBLIC' else pg_get_userbyid(role_oid) end)
          from unnest(p.polroles) role_oid
        ),
        coalesce(pg_get_expr(p.polqual, p.polrelid, true), '<NULL>'),
        coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '<NULL>')
      ) order by p.polname
    ),
    array[]::text[]
  )
  from pg_policy p
  where p.polrelid = target
$$;

create function pg_temp.notification_user_triggers(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(format('%s|%s|%s', t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true)) order by t.tgname),
    array[]::text[]
  )
  from pg_trigger t
  where t.tgrelid = target and not t.tgisinternal
$$;

create function pg_temp.notification_rewrite_rules(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(format('%s|%s|%s|%s', r.rulename, r.ev_enabled, r.is_instead, pg_get_ruledef(r.oid, true)) order by r.rulename),
    array[]::text[]
  )
  from pg_rewrite r
  where r.ev_class = target and r.rulename <> '_RETURN'
$$;

create function pg_temp.notification_table_privileges(target regclass, target_role oid)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(format('%s|%s|%s', x.privilege_type, pg_get_userbyid(x.grantor), x.is_grantable) order by x.privilege_type, x.grantor),
    array[]::text[]
  )
  from pg_class c,
       lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
  where c.oid = target and x.grantee = target_role
$$;

create function pg_temp.notification_column_privileges(target regclass)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(
      format(
        '%s|%s|%s|%s|%s',
        a.attname,
        case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
        x.privilege_type,
        pg_get_userbyid(x.grantor),
        x.is_grantable
      ) order by a.attnum, x.grantee, x.privilege_type
    ),
    array[]::text[]
  )
  from pg_attribute a
  cross join lateral aclexplode(a.attacl) x
  where a.attrelid = target and a.attnum > 0 and not a.attisdropped and a.attacl is not null
$$;

create function pg_temp.notification_unknown_table_grantees(target regclass, target_owner oid)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(distinct case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end order by case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end),
    array[]::text[]
  )
  from pg_class c,
       lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
  where c.oid = target
    and x.grantee <> target_owner
    and (x.grantee = 0 or pg_get_userbyid(x.grantee) not in ('app_ledger', 'anon', 'authenticated', 'service_role', 'app_assistant_ro'))
$$;

create function pg_temp.notification_fail(reason text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'notification_schema_conflict:%', reason using errcode = 'P0001';
end
$$;

create function pg_temp.notification_fail_count(reason text, conflicting_rows bigint)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'notification_schema_conflict:%:count=%',
    reason,
    least(conflicting_rows, 1001)
    using errcode = 'P0001';
end
$$;

do $classifier$
declare
  state_name text;
  owner_oid oid;
  owner_name text;
  relation_name text;
  relation_oid regclass;
  role_name text;
  role_oid oid;
  actual text[];
  expected text[];
  expected_full text[];
  expected_ledger text[];
  expected_assistant text[];
  config_columns text[];
  reminder_columns text[];
  rule_columns text[];
  log_columns text[];
  mismatch_count bigint;
  is_super boolean;
begin
  if to_regrole('app_ledger') is null then
    perform pg_temp.notification_fail('role_missing');
  end if;

  select oid into role_oid from pg_roles where rolname = 'app_ledger';
  if exists (
    select 1 from pg_roles
    where rolname = 'app_ledger' and (rolcanlogin or rolsuper or rolbypassrls)
  ) then
    perform pg_temp.notification_fail('role_attributes');
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role', 'app_assistant_ro'] loop
    select oid into role_oid from pg_roles where rolname = role_name;
    if role_oid is null then
      continue;
    end if;
    if pg_has_role(role_oid, to_regrole('app_ledger'), 'MEMBER')
       or pg_has_role(role_oid, to_regrole('app_ledger'), 'USAGE')
       or exists (
         with recursive reach(roleid) as (
           select m.roleid from pg_auth_members m where m.member = role_oid
           union
           select m.roleid from pg_auth_members m join reach r on m.member = r.roleid
         )
         select 1 from reach where roleid = to_regrole('app_ledger')
       ) then
      perform pg_temp.notification_fail('role_membership');
    end if;
  end loop;

  if to_regclass('public.sched_bookings') is null
     or to_regprocedure('gen_random_uuid()') is null then
    perform pg_temp.notification_fail('prerequisite_missing');
  end if;
  if not exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'public.sched_bookings'::regclass
      and a.attname = 'id'
      and not a.attisdropped
      and format_type(a.atttypid, a.atttypmod) = 'uuid'
      and a.attnotnull
  ) or not exists (
    select 1
    from pg_index i
    join unnest(i.indkey) with ordinality k(attnum, ord) on k.ord = 1
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = 'public.sched_bookings'::regclass
      and i.indisunique and i.indisvalid and i.indnkeyatts = 1 and a.attname = 'id'
  ) then
    perform pg_temp.notification_fail('booking_identity');
  end if;

  if to_regclass('public.sched_reminder_config') is null
     and to_regclass('public.sched_reminders') is null
     and to_regclass('public.notif_rules') is null
     and to_regclass('public.notif_log') is null then
    state_name := 'fresh';
    owner_oid := (select relowner from pg_class where oid = 'public.sched_bookings'::regclass);
    owner_name := current_user;
  elsif to_regclass('public.sched_reminder_config') is not null
        and to_regclass('public.sched_reminders') is not null
        and to_regclass('public.notif_rules') is null
        and to_regclass('public.notif_log') is null then
    config_columns := pg_temp.notification_columns('public.sched_reminder_config'::regclass);
    reminder_columns := pg_temp.notification_columns('public.sched_reminders'::regclass);
    if config_columns = array[
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$enabled|boolean|notnull|||false$e$,
         $e$stages|jsonb|notnull|||'[{"key": "confirmation"}, {"key": "24h", "minutesBefore": 1440}, {"key": "2h", "minutesBefore": 120}]'::jsonb$e$,
         $e$channel|text|notnull|||'whatsapp'::text$e$,
         $e$account_id|text|nullable|||<NULL>$e$,
         $e$personalize|boolean|notnull|||true$e$,
         $e$locale|text|notnull|||'es'::text$e$,
         $e$from_name|text|nullable|||<NULL>$e$,
         $e$updated_at|timestamp with time zone|notnull|||now()$e$
       ]::text[]
       and reminder_columns = array[
         $e$id|uuid|notnull|||gen_random_uuid()$e$,
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$booking_id|uuid|notnull|||<NULL>$e$,
         $e$stage|text|notnull|||<NULL>$e$,
         $e$channel|text|notnull|||<NULL>$e$,
         $e$recipient|text|nullable|||<NULL>$e$,
         $e$content|text|nullable|||<NULL>$e$,
         $e$status|text|notnull|||<NULL>$e$,
         $e$message_id|text|nullable|||<NULL>$e$,
         $e$error|text|nullable|||<NULL>$e$,
         $e$sent_at|timestamp with time zone|nullable|||<NULL>$e$,
         $e$created_at|timestamp with time zone|notnull|||now()$e$
       ]::text[] then
      state_name := 'reminder_base';
    elsif config_columns = array[
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$enabled|boolean|notnull|||false$e$,
         $e$stages|jsonb|notnull|||'[{"key": "confirmation"}, {"key": "24h", "minutesBefore": 1440}, {"key": "2h", "minutesBefore": 120}]'::jsonb$e$,
         $e$channel|text|notnull|||'whatsapp'::text$e$,
         $e$account_id|text|nullable|||<NULL>$e$,
         $e$personalize|boolean|notnull|||true$e$,
         $e$locale|text|notnull|||'es'::text$e$,
         $e$from_name|text|nullable|||<NULL>$e$,
         $e$updated_at|timestamp with time zone|notnull|||now()$e$,
         $e$channels|jsonb|notnull|||'[]'::jsonb$e$
       ]::text[]
       and reminder_columns = array[
         $e$id|uuid|notnull|||gen_random_uuid()$e$,
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$booking_id|uuid|notnull|||<NULL>$e$,
         $e$stage|text|notnull|||<NULL>$e$,
         $e$channel|text|notnull|||<NULL>$e$,
         $e$recipient|text|nullable|||<NULL>$e$,
         $e$content|text|nullable|||<NULL>$e$,
         $e$status|text|notnull|||<NULL>$e$,
         $e$message_id|text|nullable|||<NULL>$e$,
         $e$error|text|nullable|||<NULL>$e$,
         $e$sent_at|timestamp with time zone|nullable|||<NULL>$e$,
         $e$created_at|timestamp with time zone|notnull|||now()$e$,
         $e$recipient_role|text|notnull|||'client'::text$e$
       ]::text[] then
      state_name := 'reminder_multichannel';
    elsif config_columns = array[
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$enabled|boolean|notnull|||false$e$,
         $e$stages|jsonb|notnull|||'[{"key": "confirmation"}, {"key": "24h", "minutesBefore": 1440}, {"key": "2h", "minutesBefore": 120}]'::jsonb$e$,
         $e$channel|text|notnull|||'whatsapp'::text$e$,
         $e$account_id|text|nullable|||<NULL>$e$,
         $e$personalize|boolean|notnull|||true$e$,
         $e$locale|text|notnull|||'es'::text$e$,
         $e$from_name|text|nullable|||<NULL>$e$,
         $e$updated_at|timestamp with time zone|notnull|||now()$e$,
         $e$channels|jsonb|notnull|||'[]'::jsonb$e$,
         $e$infer_confirmation|boolean|notnull|||false$e$
       ]::text[]
       and reminder_columns = array[
         $e$id|uuid|notnull|||gen_random_uuid()$e$,
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$booking_id|uuid|notnull|||<NULL>$e$,
         $e$stage|text|notnull|||<NULL>$e$,
         $e$channel|text|notnull|||<NULL>$e$,
         $e$recipient|text|nullable|||<NULL>$e$,
         $e$content|text|nullable|||<NULL>$e$,
         $e$status|text|notnull|||<NULL>$e$,
         $e$message_id|text|nullable|||<NULL>$e$,
         $e$error|text|nullable|||<NULL>$e$,
         $e$sent_at|timestamp with time zone|nullable|||<NULL>$e$,
         $e$created_at|timestamp with time zone|notnull|||now()$e$,
         $e$recipient_role|text|notnull|||'client'::text$e$
       ]::text[] then
      state_name := 'reminder_inference';
    else
      perform pg_temp.notification_fail('column_manifest');
    end if;
  elsif to_regclass('public.sched_reminder_config') is not null
        and to_regclass('public.sched_reminders') is not null
        and to_regclass('public.notif_rules') is not null
        and to_regclass('public.notif_log') is not null then
    state_name := 'legacy_complete';
  else
    perform pg_temp.notification_fail('target_presence');
  end if;

  if state_name <> 'fresh' then
    select min(c.relowner), min(pg_get_userbyid(c.relowner)), count(distinct c.relowner)
      into owner_oid, owner_name, mismatch_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and (
          c.relname in ('sched_reminder_config', 'sched_reminders')
          or (
            state_name = 'legacy_complete'
            and c.relname in ('notif_rules', 'notif_log')
          )
        );
    if mismatch_count <> 1 or owner_name in ('app_ledger', 'app_assistant_ro', 'anon', 'authenticated', 'service_role') then
      perform pg_temp.notification_fail('table_owner');
    end if;
    select rolsuper into is_super from pg_roles where rolname = current_user;
    if current_user <> owner_name and not coalesce(is_super, false)
       and not pg_has_role(current_user, owner_oid, 'MEMBER') then
      perform pg_temp.notification_fail('owner_authority');
    end if;
  end if;

  if state_name = 'legacy_complete' then
    config_columns := pg_temp.notification_columns('public.sched_reminder_config'::regclass);
    reminder_columns := pg_temp.notification_columns('public.sched_reminders'::regclass);
    rule_columns := pg_temp.notification_columns('public.notif_rules'::regclass);
    log_columns := pg_temp.notification_columns('public.notif_log'::regclass);
    if config_columns <> array[
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$enabled|boolean|notnull|||false$e$,
         $e$stages|jsonb|notnull|||'[{"key": "confirmation"}, {"key": "24h", "minutesBefore": 1440}, {"key": "2h", "minutesBefore": 120}]'::jsonb$e$,
         $e$channel|text|notnull|||'whatsapp'::text$e$,
         $e$account_id|text|nullable|||<NULL>$e$,
         $e$personalize|boolean|notnull|||true$e$,
         $e$locale|text|notnull|||'es'::text$e$,
         $e$from_name|text|nullable|||<NULL>$e$,
         $e$updated_at|timestamp with time zone|notnull|||now()$e$,
         $e$channels|jsonb|notnull|||'[]'::jsonb$e$,
         $e$infer_confirmation|boolean|notnull|||false$e$
       ]::text[]
       or reminder_columns <> array[
         $e$id|uuid|notnull|||gen_random_uuid()$e$,
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$booking_id|uuid|notnull|||<NULL>$e$,
         $e$stage|text|notnull|||<NULL>$e$,
         $e$channel|text|notnull|||<NULL>$e$,
         $e$recipient|text|nullable|||<NULL>$e$,
         $e$content|text|nullable|||<NULL>$e$,
         $e$status|text|notnull|||<NULL>$e$,
         $e$message_id|text|nullable|||<NULL>$e$,
         $e$error|text|nullable|||<NULL>$e$,
         $e$sent_at|timestamp with time zone|nullable|||<NULL>$e$,
         $e$created_at|timestamp with time zone|notnull|||now()$e$,
         $e$recipient_role|text|notnull|||'client'::text$e$
       ]::text[]
       or rule_columns <> array[
         $e$id|uuid|notnull|||gen_random_uuid()$e$,
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$name|text|notnull|||<NULL>$e$,
         $e$enabled|boolean|notnull|||true$e$,
         $e$trigger_table|text|notnull|||<NULL>$e$,
         $e$trigger_event|text|notnull|||<NULL>$e$,
         $e$date_field|text|nullable|||<NULL>$e$,
         $e$date_offset_mins|integer|nullable|||<NULL>$e$,
         $e$condition|jsonb|notnull|||'[]'::jsonb$e$,
         $e$recipients|jsonb|notnull|||'[]'::jsonb$e$,
         $e$channel|text|notnull|||<NULL>$e$,
         $e$account_id|text|nullable|||<NULL>$e$,
         $e$template|text|notnull|||<NULL>$e$,
         $e$last_run_at|timestamp with time zone|nullable|||<NULL>$e$,
         $e$created_at|timestamp with time zone|notnull|||now()$e$,
         $e$updated_at|timestamp with time zone|notnull|||now()$e$
       ]::text[]
       or log_columns <> array[
         $e$id|uuid|notnull|||gen_random_uuid()$e$,
         $e$org_id|text|notnull|||<NULL>$e$,
         $e$rule_id|uuid|notnull|||<NULL>$e$,
         $e$entity_id|text|notnull|||<NULL>$e$,
         $e$trigger_key|text|notnull|||<NULL>$e$,
         $e$channel|text|notnull|||<NULL>$e$,
         $e$recipient|text|nullable|||<NULL>$e$,
         $e$content|text|nullable|||<NULL>$e$,
         $e$status|text|notnull|||<NULL>$e$,
         $e$error|text|nullable|||<NULL>$e$,
         $e$message_id|text|nullable|||<NULL>$e$,
         $e$created_at|timestamp with time zone|notnull|||now()$e$
       ]::text[] then
      perform pg_temp.notification_fail('column_manifest');
    end if;
  end if;

  if state_name <> 'fresh' then
    foreach relation_name in array (
      case when state_name = 'legacy_complete'
        then array['sched_reminder_config', 'sched_reminders', 'notif_rules', 'notif_log']
        else array['sched_reminder_config', 'sched_reminders']
      end
    ) loop
      relation_oid := to_regclass(format('public.%I', relation_name));
      if not exists (
        select 1 from pg_class c
        where c.oid = relation_oid and c.relkind = 'r' and c.relpersistence = 'p'
          and not c.relispartition and c.relrowsecurity and c.relforcerowsecurity
      ) or exists (
        select 1 from pg_inherits where inhrelid = relation_oid or inhparent = relation_oid
      ) then
        perform pg_temp.notification_fail('relation_shape');
      end if;

      if relation_name = 'sched_reminder_config' then
        expected := array[
          'sched_reminder_config_pkey|p|PRIMARY KEY (org_id)|t|f|f'
        ];
      elsif relation_name = 'sched_reminders' then
        expected := array[
          'sched_reminders_booking_id_fkey|f|FOREIGN KEY (booking_id) REFERENCES public.sched_bookings(id) ON DELETE CASCADE|t|f|f',
          'sched_reminders_pkey|p|PRIMARY KEY (id)|t|f|f'
        ];
      elsif relation_name = 'notif_rules' then
        expected := array['notif_rules_pkey|p|PRIMARY KEY (id)|t|f|f'];
      else
        expected := array['notif_log_pkey|p|PRIMARY KEY (id)|t|f|f'];
      end if;
      expected := pg_temp.notification_sorted(
        expected || pg_temp.notification_expected_not_null_constraints(relation_oid)
      );
      if pg_temp.notification_constraints(relation_oid) is distinct from expected then
        perform pg_temp.notification_fail('constraint_manifest');
      end if;

      if relation_name = 'sched_reminder_config' then
        expected := array[
          'sched_reminder_config_pkey|CREATE UNIQUE INDEX sched_reminder_config_pkey ON public.sched_reminder_config USING btree (org_id)'
        ];
      elsif relation_name = 'sched_reminders' and state_name = 'reminder_base' then
        expected := array[
          'sched_reminders_booking_idx|CREATE INDEX sched_reminders_booking_idx ON public.sched_reminders USING btree (booking_id)',
          'sched_reminders_booking_stage_uniq|CREATE UNIQUE INDEX sched_reminders_booking_stage_uniq ON public.sched_reminders USING btree (org_id, booking_id, stage)',
          'sched_reminders_org_created_idx|CREATE INDEX sched_reminders_org_created_idx ON public.sched_reminders USING btree (org_id, created_at)',
          'sched_reminders_pkey|CREATE UNIQUE INDEX sched_reminders_pkey ON public.sched_reminders USING btree (id)'
        ];
      elsif relation_name = 'sched_reminders' then
        expected := array[
          'sched_reminders_booking_idx|CREATE INDEX sched_reminders_booking_idx ON public.sched_reminders USING btree (booking_id)',
          'sched_reminders_booking_stage_chan_uniq|CREATE UNIQUE INDEX sched_reminders_booking_stage_chan_uniq ON public.sched_reminders USING btree (org_id, booking_id, stage, channel, recipient_role)',
          'sched_reminders_org_created_idx|CREATE INDEX sched_reminders_org_created_idx ON public.sched_reminders USING btree (org_id, created_at)',
          'sched_reminders_pkey|CREATE UNIQUE INDEX sched_reminders_pkey ON public.sched_reminders USING btree (id)'
        ];
      elsif relation_name = 'notif_rules' then
        expected := array[
          'notif_rules_org_idx|CREATE INDEX notif_rules_org_idx ON public.notif_rules USING btree (org_id)',
          'notif_rules_pkey|CREATE UNIQUE INDEX notif_rules_pkey ON public.notif_rules USING btree (id)'
        ];
      else
        expected := array[
          'notif_log_org_idx|CREATE INDEX notif_log_org_idx ON public.notif_log USING btree (org_id, created_at)',
          'notif_log_pkey|CREATE UNIQUE INDEX notif_log_pkey ON public.notif_log USING btree (id)',
          'notif_log_rule_entity_key_uniq|CREATE UNIQUE INDEX notif_log_rule_entity_key_uniq ON public.notif_log USING btree (rule_id, entity_id, trigger_key)'
        ];
      end if;
      if pg_temp.notification_indexes(relation_oid) is distinct from expected then
        perform pg_temp.notification_fail('index_manifest');
      end if;

      expected := array[
        format(
          '%s_org_guc|*|t|PUBLIC|org_id = current_setting(''app.current_org_id''::text, true)|org_id = current_setting(''app.current_org_id''::text, true)',
          relation_name
        )
      ];
      if pg_temp.notification_policies(relation_oid) is distinct from expected then
        perform pg_temp.notification_fail('policy_manifest');
      end if;
      if pg_temp.notification_user_triggers(relation_oid) <> array[]::text[] then
        perform pg_temp.notification_fail('trigger_manifest');
      end if;
      if pg_temp.notification_rewrite_rules(relation_oid) <> array[]::text[] then
        perform pg_temp.notification_fail('rewrite_manifest');
      end if;
      if pg_temp.notification_column_privileges(relation_oid) <> array[]::text[] then
        perform pg_temp.notification_fail('column_acl');
      end if;
      if pg_temp.notification_unknown_table_grantees(relation_oid, owner_oid) <> array[]::text[] then
        perform pg_temp.notification_fail('table_acl_grantee');
      end if;

      expected_full := pg_temp.notification_expected_owner_privileges(owner_name);
      if pg_temp.notification_table_privileges(relation_oid, owner_oid) is distinct from expected_full
         or pg_temp.notification_table_privileges(relation_oid, 0) <> array[]::text[] then
        perform pg_temp.notification_fail('table_acl_owner');
      end if;

      expected_ledger := case when relation_name = 'notif_log'
        then array[format('INSERT|%s|f', owner_name), format('SELECT|%s|f', owner_name)]
        else array[
          format('DELETE|%s|f', owner_name),
          format('INSERT|%s|f', owner_name),
          format('SELECT|%s|f', owner_name),
          format('UPDATE|%s|f', owner_name)
        ] end;
      if pg_temp.notification_table_privileges(relation_oid, to_regrole('app_ledger')) is distinct from expected_ledger then
        perform pg_temp.notification_fail('table_acl_ledger');
      end if;

      foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
        role_oid := to_regrole(role_name);
        if role_oid is not null and pg_temp.notification_table_privileges(relation_oid, role_oid) is distinct from expected_full then
          perform pg_temp.notification_fail('table_acl_browser');
        end if;
      end loop;
      role_oid := to_regrole('app_assistant_ro');
      if role_oid is not null then
        expected_assistant := case when state_name = 'legacy_complete' and relation_name in ('sched_reminders', 'notif_log')
          then array[format('SELECT|%s|f', owner_name)] else array[]::text[] end;
        if pg_temp.notification_table_privileges(relation_oid, role_oid) is distinct from expected_assistant then
          perform pg_temp.notification_fail('table_acl_assistant');
        end if;
      end if;
    end loop;

    select count(*) into mismatch_count
    from public.sched_reminders r
    left join public.sched_bookings b on b.id = r.booking_id
    where b.id is null;
    if mismatch_count > 0 then
      perform pg_temp.notification_fail_count('orphan_booking', mismatch_count);
    end if;

    select count(*) into mismatch_count
    from public.sched_reminders
    where status not in ('sending', 'sent', 'failed', 'skipped')
       or (status = 'sent' and sent_at is null)
       or (status <> 'sent' and sent_at is not null);
    if mismatch_count > 0 then
      perform pg_temp.notification_fail_count('reminder_state', mismatch_count);
    end if;

    if state_name = 'legacy_complete' then
      select count(*) into mismatch_count from public.notif_log where status not in ('sent', 'failed');
      if mismatch_count > 0 then
        perform pg_temp.notification_fail_count('notification_state', mismatch_count);
      end if;
    end if;
  end if;

  if to_regprocedure('public.enforce_sched_reminder_transition()') is not null then
    perform pg_temp.notification_fail('function_collision');
  end if;
  insert into pg_temp.notification_reconciliation_scope(state, owner_name)
  values (state_name, owner_name);
end
$classifier$;

do $converge$
declare
  state_name text;
  owner_name text;
begin
  select state, notification_reconciliation_scope.owner_name
    into state_name, owner_name
    from pg_temp.notification_reconciliation_scope;

  if state_name = 'fresh' then
    create table public.sched_reminder_config (
      org_id text primary key,
      enabled boolean not null default false,
      stages jsonb not null default '[{"key":"confirmation"},{"key":"24h","minutesBefore":1440},{"key":"2h","minutesBefore":120}]'::jsonb,
      channel text not null default 'whatsapp',
      account_id text,
      personalize boolean not null default true,
      locale text not null default 'es',
      from_name text,
      updated_at timestamptz not null default now(),
      channels jsonb not null default '[]'::jsonb,
      infer_confirmation boolean not null default false
    );
    create table public.sched_reminders (
      id uuid primary key default gen_random_uuid(),
      org_id text not null,
      booking_id uuid not null references public.sched_bookings(id) on delete cascade,
      stage text not null,
      channel text not null,
      recipient text,
      content text,
      status text not null,
      message_id text,
      error text,
      sent_at timestamptz,
      created_at timestamptz not null default now(),
      recipient_role text not null default 'client'
    );
    create unique index sched_reminders_booking_stage_chan_uniq
      on public.sched_reminders (org_id, booking_id, stage, channel, recipient_role);
    create index sched_reminders_org_created_idx on public.sched_reminders (org_id, created_at);
    create index sched_reminders_booking_idx on public.sched_reminders (booking_id);
  elsif state_name = 'reminder_base' then
    alter table public.sched_reminder_config
      add column channels jsonb not null default '[]'::jsonb;
    alter table public.sched_reminders
      add column recipient_role text not null default 'client';
    drop index public.sched_reminders_booking_stage_uniq;
    create unique index sched_reminders_booking_stage_chan_uniq
      on public.sched_reminders (org_id, booking_id, stage, channel, recipient_role);
    alter table public.sched_reminder_config
      add column infer_confirmation boolean not null default false;
  elsif state_name = 'reminder_multichannel' then
    alter table public.sched_reminder_config
      add column infer_confirmation boolean not null default false;
  end if;

  if state_name <> 'legacy_complete' then
    create table public.notif_rules (
      id uuid primary key default gen_random_uuid(),
      org_id text not null,
      name text not null,
      enabled boolean not null default true,
      trigger_table text not null,
      trigger_event text not null,
      date_field text,
      date_offset_mins integer,
      condition jsonb not null default '[]'::jsonb,
      recipients jsonb not null default '[]'::jsonb,
      channel text not null,
      account_id text,
      template text not null,
      last_run_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index notif_rules_org_idx on public.notif_rules (org_id);
    create table public.notif_log (
      id uuid primary key default gen_random_uuid(),
      org_id text not null,
      rule_id uuid not null,
      entity_id text not null,
      trigger_key text not null,
      channel text not null,
      recipient text,
      content text,
      status text not null,
      error text,
      message_id text,
      created_at timestamptz not null default now()
    );
    create unique index notif_log_rule_entity_key_uniq
      on public.notif_log (rule_id, entity_id, trigger_key);
    create index notif_log_org_idx on public.notif_log (org_id, created_at);
    if owner_name <> current_user then
      execute format('alter table public.notif_rules owner to %I', owner_name);
      execute format('alter table public.notif_log owner to %I', owner_name);
    end if;
  end if;
end
$converge$;

alter table public.sched_reminders
  add constraint sched_reminders_status_check
  check (status in ('sending', 'sent', 'failed', 'skipped'));
alter table public.sched_reminders
  add constraint sched_reminders_status_sent_at_check
  check (
    (status = 'sent' and sent_at is not null)
    or (status in ('sending', 'failed', 'skipped') and sent_at is null)
  );
alter table public.notif_log
  add constraint notif_log_status_check
  check (status in ('sent', 'failed'));

comment on table public.notif_log is
  'Legacy notification claims. Rows are not provider delivery receipts.';
comment on column public.notif_log.status is
  'Untrusted legacy claim status; not provider acceptance, delivery, or human receipt.';

create function public.enforce_sched_reminder_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'sending' then
      raise exception 'sched_reminder_transition_rejected' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status <> 'sending'
     or new.status not in ('sent', 'failed', 'skipped')
     or new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.booking_id is distinct from old.booking_id
     or new.stage is distinct from old.stage
     or new.channel is distinct from old.channel
     or new.recipient_role is distinct from old.recipient_role
     or new.recipient is distinct from old.recipient
     or new.created_at is distinct from old.created_at then
    raise exception 'sched_reminder_transition_rejected' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger sched_reminders_legal_transition
before insert or update on public.sched_reminders
for each row execute function public.enforce_sched_reminder_transition();

alter table public.sched_reminder_config enable row level security;
alter table public.sched_reminder_config force row level security;
alter table public.sched_reminders enable row level security;
alter table public.sched_reminders force row level security;
alter table public.notif_rules enable row level security;
alter table public.notif_rules force row level security;
alter table public.notif_log enable row level security;
alter table public.notif_log force row level security;

drop policy if exists sched_reminder_config_org_guc on public.sched_reminder_config;
drop policy if exists sched_reminders_org_guc on public.sched_reminders;
drop policy if exists notif_rules_org_guc on public.notif_rules;
drop policy if exists notif_log_org_guc on public.notif_log;
create policy sched_reminder_config_org_guc on public.sched_reminder_config
  as permissive for all to app_ledger
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
create policy sched_reminders_org_guc on public.sched_reminders
  as permissive for all to app_ledger
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
create policy notif_rules_org_guc on public.notif_rules
  as permissive for all to app_ledger
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
create policy notif_log_org_guc on public.notif_log
  as permissive for all to app_ledger
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

do $privileges$
declare
  relation_name text;
  column_name text;
  role_name text;
begin
  foreach relation_name in array array['sched_reminder_config', 'sched_reminders', 'notif_rules', 'notif_log'] loop
    execute format('revoke all privileges on table public.%I from public', relation_name);
    execute format('revoke all privileges on table public.%I from app_ledger', relation_name);
    for column_name in
      select a.attname from pg_attribute a
      where a.attrelid = to_regclass(format('public.%I', relation_name))
        and a.attnum > 0 and not a.attisdropped
    loop
      execute format('revoke all privileges (%I) on table public.%I from public', column_name, relation_name);
      execute format('revoke all privileges (%I) on table public.%I from app_ledger', column_name, relation_name);
    end loop;
    foreach role_name in array array['anon', 'authenticated', 'service_role', 'app_assistant_ro'] loop
      if to_regrole(role_name) is null then continue; end if;
      execute format('revoke all privileges on table public.%I from %I', relation_name, role_name);
      for column_name in
        select a.attname from pg_attribute a
        where a.attrelid = to_regclass(format('public.%I', relation_name))
          and a.attnum > 0 and not a.attisdropped
      loop
        execute format('revoke all privileges (%I) on table public.%I from %I', column_name, relation_name, role_name);
      end loop;
    end loop;
  end loop;
end
$privileges$;

grant select, insert, update, delete on public.sched_reminder_config to app_ledger;
grant select, insert, update, delete on public.sched_reminders to app_ledger;
grant select, insert, update, delete on public.notif_rules to app_ledger;
grant select, insert on public.notif_log to app_ledger;

revoke all privileges on function public.enforce_sched_reminder_transition() from public;
revoke all privileges on function public.enforce_sched_reminder_transition() from app_ledger;
do $function_privileges$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'app_assistant_ro'] loop
    if to_regrole(role_name) is not null then
      execute format(
        'revoke all privileges on function public.enforce_sched_reminder_transition() from %I',
        role_name
      );
    end if;
  end loop;
end
$function_privileges$;

do $final_assertion$
declare
  relation_name text;
  relation_oid regclass;
  owner_oid oid;
  owner_name text;
  role_name text;
  role_oid oid;
  privilege_name text;
  column_name text;
  expected text[];
  expected_full text[];
  expected_ledger text[];
  should_have boolean;
begin
  select c.relowner, pg_get_userbyid(c.relowner)
    into owner_oid, owner_name
    from pg_class c where c.oid = 'public.sched_reminder_config'::regclass;
  foreach relation_name in array array['sched_reminder_config', 'sched_reminders', 'notif_rules', 'notif_log'] loop
    relation_oid := to_regclass(format('public.%I', relation_name));
    if not exists (
      select 1 from pg_class c
      where c.oid = relation_oid and c.relowner = owner_oid and c.relkind = 'r'
        and c.relpersistence = 'p' and not c.relispartition
        and c.relrowsecurity and c.relforcerowsecurity
    ) or pg_temp.notification_rewrite_rules(relation_oid) <> array[]::text[]
       or pg_temp.notification_column_privileges(relation_oid) <> array[]::text[]
       or pg_temp.notification_unknown_table_grantees(relation_oid, owner_oid) <> array[]::text[] then
      perform pg_temp.notification_fail('final_relation');
    end if;

    if pg_temp.notification_columns(relation_oid) is distinct from
         pg_temp.notification_final_columns(relation_name) then
      perform pg_temp.notification_fail('final_column_manifest');
    end if;
    if pg_temp.notification_indexes(relation_oid) is distinct from
         pg_temp.notification_final_indexes(relation_name) then
      perform pg_temp.notification_fail('final_index_manifest');
    end if;

    expected := array[
      format(
        '%s_org_guc|*|t|app_ledger|org_id = current_setting(''app.current_org_id''::text, true)|org_id = current_setting(''app.current_org_id''::text, true)',
        relation_name
      )
    ];
    if pg_temp.notification_policies(relation_oid) is distinct from expected then
      perform pg_temp.notification_fail('final_policy');
    end if;

    expected_full := pg_temp.notification_expected_owner_privileges(owner_name);
    expected_ledger := case when relation_name = 'notif_log'
      then array[format('INSERT|%s|f', owner_name), format('SELECT|%s|f', owner_name)]
      else array[
        format('DELETE|%s|f', owner_name),
        format('INSERT|%s|f', owner_name),
        format('SELECT|%s|f', owner_name),
        format('UPDATE|%s|f', owner_name)
      ] end;
    if pg_temp.notification_table_privileges(relation_oid, owner_oid) is distinct from expected_full
       or pg_temp.notification_table_privileges(relation_oid, to_regrole('app_ledger')) is distinct from expected_ledger
       or pg_temp.notification_table_privileges(relation_oid, 0) <> array[]::text[] then
      perform pg_temp.notification_fail('final_acl');
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role', 'app_assistant_ro'] loop
      role_oid := to_regrole(role_name);
      if role_oid is null then continue; end if;
      if pg_temp.notification_table_privileges(relation_oid, role_oid) <> array[]::text[] then
        perform pg_temp.notification_fail('final_acl');
      end if;
      foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(role_oid, relation_oid, privilege_name) then
          perform pg_temp.notification_fail('final_effective_acl');
        end if;
      end loop;
      if current_setting('server_version_num')::integer >= 180000
         and has_table_privilege(role_oid, relation_oid, 'MAINTAIN') then
        perform pg_temp.notification_fail('final_effective_acl');
      end if;
      for column_name in
        select a.attname from pg_attribute a
        where a.attrelid = relation_oid and a.attnum > 0 and not a.attisdropped
      loop
        foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
          if has_column_privilege(role_oid, relation_oid, column_name, privilege_name) then
            perform pg_temp.notification_fail('final_effective_column_acl');
          end if;
        end loop;
      end loop;
    end loop;

    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      should_have := relation_name <> 'notif_log' or privilege_name in ('SELECT', 'INSERT');
      if has_table_privilege(to_regrole('app_ledger'), relation_oid, privilege_name) <> should_have then
        perform pg_temp.notification_fail('final_ledger_acl');
      end if;
    end loop;
  end loop;

  if pg_temp.notification_user_triggers('public.sched_reminder_config'::regclass) <> array[]::text[]
     or pg_temp.notification_user_triggers('public.notif_rules'::regclass) <> array[]::text[]
     or pg_temp.notification_user_triggers('public.notif_log'::regclass) <> array[]::text[]
     or cardinality(pg_temp.notification_user_triggers('public.sched_reminders'::regclass)) <> 1
     or not exists (
       select 1
       from pg_trigger t
       join pg_proc p on p.oid = t.tgfoid
       join pg_namespace n on n.oid = p.pronamespace
       where t.tgrelid = 'public.sched_reminders'::regclass
         and not t.tgisinternal
         and t.tgname = 'sched_reminders_legal_transition'
         and t.tgenabled = 'O'
         and n.nspname = 'public'
         and p.proname = 'enforce_sched_reminder_transition'
         and not p.prosecdef
         and p.proconfig @> array['search_path=pg_catalog, public']
     ) then
    perform pg_temp.notification_fail('final_trigger');
  end if;

  foreach role_name in array array[
    'app_ledger', 'anon', 'authenticated', 'service_role', 'app_assistant_ro'
  ] loop
    role_oid := to_regrole(role_name);
    if role_oid is not null
       and has_function_privilege(
         role_oid,
         'public.enforce_sched_reminder_transition()'::regprocedure,
         'EXECUTE'
       ) then
      perform pg_temp.notification_fail('final_trigger_acl');
    end if;
  end loop;

  if obj_description('public.notif_log'::regclass, 'pg_class') is distinct from
       'Legacy notification claims. Rows are not provider delivery receipts.'
     or col_description(
       'public.notif_log'::regclass,
       (select attnum from pg_attribute
        where attrelid='public.notif_log'::regclass and attname='status')
     ) is distinct from
       'Untrusted legacy claim status; not provider acceptance, delivery, or human receipt.' then
    perform pg_temp.notification_fail('final_comment');
  end if;

  relation_oid := 'public.sched_reminder_config'::regclass;
  expected := pg_temp.notification_sorted(
    array['sched_reminder_config_pkey|p|PRIMARY KEY (org_id)|t|f|f']::text[]
    || pg_temp.notification_expected_not_null_constraints(relation_oid)
  );
  if pg_temp.notification_constraints(relation_oid) is distinct from expected then
    perform pg_temp.notification_fail('final_constraint_config');
  end if;

  relation_oid := 'public.sched_reminders'::regclass;
  expected := pg_temp.notification_sorted(
    array[
      'sched_reminders_booking_id_fkey|f|FOREIGN KEY (booking_id) REFERENCES public.sched_bookings(id) ON DELETE CASCADE|t|f|f',
      $e$sched_reminders_status_check|c|CHECK (status = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))|t|f|f$e$,
      $e$sched_reminders_status_sent_at_check|c|CHECK (status = 'sent'::text AND sent_at IS NOT NULL OR (status = ANY (ARRAY['sending'::text, 'failed'::text, 'skipped'::text])) AND sent_at IS NULL)|t|f|f$e$,
      'sched_reminders_pkey|p|PRIMARY KEY (id)|t|f|f'
    ]::text[] || pg_temp.notification_expected_not_null_constraints(relation_oid)
  );
  if pg_temp.notification_constraints(relation_oid) is distinct from expected then
    perform pg_temp.notification_fail('final_constraint_reminders');
  end if;

  relation_oid := 'public.notif_rules'::regclass;
  expected := pg_temp.notification_sorted(
    array['notif_rules_pkey|p|PRIMARY KEY (id)|t|f|f']::text[]
    || pg_temp.notification_expected_not_null_constraints(relation_oid)
  );
  if pg_temp.notification_constraints(relation_oid) is distinct from expected then
    perform pg_temp.notification_fail('final_constraint_rules');
  end if;

  relation_oid := 'public.notif_log'::regclass;
  expected := pg_temp.notification_sorted(
    array[
      $e$notif_log_status_check|c|CHECK (status = ANY (ARRAY['sent'::text, 'failed'::text]))|t|f|f$e$,
      'notif_log_pkey|p|PRIMARY KEY (id)|t|f|f'
    ]::text[] || pg_temp.notification_expected_not_null_constraints(relation_oid)
  );
  if pg_temp.notification_constraints(relation_oid) is distinct from expected then
    perform pg_temp.notification_fail('final_constraint_log');
  end if;
end
$final_assertion$;
