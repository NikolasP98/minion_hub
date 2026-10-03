-- Slice4 operational authority. Source writes remain event/outbox-local.
-- See meta specs/2026-10-03-notification-slice4-worker-health-spec.md.
do $$
declare role_name text;
begin
  if current_user in ('app_ledger','anon','authenticated','service_role','app_assistant_ro',
    'notification_worker','notification_event_trigger') or exists (
      select 1 from pg_roles where rolname in ('app_ledger','anon','authenticated',
        'service_role','app_assistant_ro','notification_worker','notification_event_trigger')
        and pg_has_role(oid,current_user,'MEMBER')
    ) then raise exception 'Notification scheduler requires the trusted backend owner'; end if;
  foreach role_name in array array['notification_coordinator','notification_health_reader'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      raise exception 'Notification scheduler role reconciliation required';
    end if;
    execute format('create role %I nologin nosuperuser nobypassrls noinherit nocreatedb nocreaterole noreplication',role_name);
    execute format('grant %I to %I',role_name,current_user);
  end loop;
end $$;
grant usage on schema public to notification_coordinator,notification_health_reader;

-- Adopt existing immutable source provenance once in the migration transaction.
-- Disable only the transition trigger that deliberately prohibits ordinary backfills.
alter table public.notification_outbox add column enqueued_at timestamptz;
alter table public.notification_outbox disable trigger notification_outbox_transition;
update public.notification_outbox o set enqueued_at=e.created_at
  from public.notification_events e where e.id=o.event_id and e.organization_id=o.organization_id;
alter table public.notification_outbox enable trigger notification_outbox_transition;
alter table public.notification_outbox alter column enqueued_at set not null;
alter table public.notification_outbox alter column enqueued_at set default clock_timestamp();
alter table public.notification_outbox add constraint notification_outbox_enqueued_finite check(isfinite(enqueued_at));
create index notification_pending_health_idx on public.notification_outbox(organization_id,enqueued_at,event_id) where state='pending';
create index notification_processing_health_idx on public.notification_outbox(organization_id,enqueued_at,event_id) where state='processing';

create function public.notification_outbox_provenance_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.enqueued_at:=clock_timestamp();
  elsif new.enqueued_at is distinct from old.enqueued_at then
    raise exception 'Notification queue provenance is immutable';
  end if;
  return new;
end $$;
create trigger notification_outbox_provenance before insert or update on public.notification_outbox
  for each row execute function public.notification_outbox_provenance_guard();

create table public.notification_org_control (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  state text not null default 'idle' check(state in ('idle','running')),
  generation bigint not null default 0 check(generation>=0),
  owner_id uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  hard_deadline timestamptz,
  renewal_count integer,
  next_due_at timestamptz not null default clock_timestamp() check(isfinite(next_due_at)),
  failure_streak integer not null default 0 check(failure_streak between 0 and 4),
  last_failure_code text check(last_failure_code in ('deadline','statement_timeout','lock_timeout','database_unavailable','projection_failed')),
  last_result text check(last_result in ('completed','failed','unsupported','empty')),
  last_completed_at timestamptz check(isfinite(last_completed_at)),
  last_success_at timestamptz check(isfinite(last_success_at)),
  check((state='running' and owner_id is not null and claimed_at is not null and isfinite(claimed_at)
    and hard_deadline=claimed_at+interval '60 seconds' and hard_deadline is not null
    and lease_expires_at is not null and lease_expires_at>claimed_at and lease_expires_at<=hard_deadline
    and renewal_count in (0,1) and renewal_count is not null)
    or (state='idle' and owner_id is null and claimed_at is null and lease_expires_at is null
      and hard_deadline is null and renewal_count is null)),
  check((failure_streak=0)=(last_failure_code is null))
);

create table public.notification_scheduler_cursor (
  singleton boolean primary key default true check(singleton),
  schema_version integer not null default 1 check(schema_version=1),
  pending_after_org uuid,
  processing_after_org uuid,
  next_state text not null default 'pending' check(next_state in ('pending','processing')),
  tick_generation bigint not null default 0 check(tick_generation>=0)
);
insert into public.notification_scheduler_cursor(singleton) values(true);

create table public.notification_worker_runtime (
  singleton boolean primary key default true check(singleton),
  schema_version integer not null default 1 check(schema_version=1),
  generation bigint not null default 0 check(generation>=0),
  owner_id uuid,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz check(isfinite(last_heartbeat_at)),
  started_at timestamptz check(isfinite(started_at)),
  stopped_at timestamptz check(isfinite(stopped_at)),
  build_sha text check(build_sha ~ '^[a-f0-9]{40}$'),
  catalog_revision text collate "C" check(catalog_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$'),
  catalog_sha256 text check(catalog_sha256 ~ '^[a-f0-9]{64}$'),
  projector_revision text check(projector_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$'),
  projector_sha256 text check(projector_sha256 ~ '^[a-f0-9]{64}$'),
  admission_generation bigint not null default 0 check(admission_generation>=0),
  admission_owner_id uuid,
  admission_checked_at timestamptz check(isfinite(admission_checked_at)),
  admission_code text check(admission_code in ('catalog_invalid','catalog_mismatch','projection_unavailable','build_unavailable','startup_failed')),
  admission_build_sha text check(admission_build_sha ~ '^[a-f0-9]{40}$'),
  admission_artifact_sha256 text check(admission_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  admission_catalog_revision text check(admission_catalog_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$'),
  admission_catalog_sha256 text check(admission_catalog_sha256 ~ '^[a-f0-9]{64}$'),
  admission_projector_revision text check(admission_projector_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$'),
  admission_projector_sha256 text check(admission_projector_sha256 ~ '^[a-f0-9]{64}$'),
  check((owner_id is null and lease_expires_at is null) or
    (owner_id is not null and lease_expires_at is not null and isfinite(lease_expires_at)
      and last_heartbeat_at is not null and started_at is not null and stopped_at is null
      and lease_expires_at=last_heartbeat_at+interval '30 seconds'
      and build_sha is not null and catalog_revision is not null and catalog_sha256 is not null
      and projector_revision is not null and projector_sha256 is not null)),
  check((admission_generation=0 and admission_owner_id is null and admission_checked_at is null
    and admission_code is null and admission_build_sha is null and admission_artifact_sha256 is null
    and admission_catalog_revision is null and admission_catalog_sha256 is null and admission_projector_revision is null and admission_projector_sha256 is null)
    or (admission_generation>0 and admission_owner_id is not null and admission_checked_at is not null
      and admission_code is not null))
);
insert into public.notification_worker_runtime(singleton) values(true);

alter table public.notification_org_control enable row level security;
alter table public.notification_org_control force row level security;
alter table public.notification_scheduler_cursor enable row level security;
alter table public.notification_scheduler_cursor force row level security;
alter table public.notification_worker_runtime enable row level security;
alter table public.notification_worker_runtime force row level security;
create policy notification_control_coordinator on public.notification_org_control for all to notification_coordinator using(true) with check(true);
create policy notification_cursor_coordinator on public.notification_scheduler_cursor for all to notification_coordinator using(true) with check(true);
create policy notification_runtime_coordinator on public.notification_worker_runtime for all to notification_coordinator using(true) with check(true);
create policy notification_discovery_coordinator on public.notification_outbox for select to notification_coordinator using(true);
create policy notification_control_health on public.notification_org_control for select to notification_health_reader
  using(organization_id=nullif(current_setting('app.current_org_id',true),'')::uuid);
create policy notification_outbox_health on public.notification_outbox for select to notification_health_reader
  using(organization_id=nullif(current_setting('app.current_org_id',true),'')::uuid);
create policy notification_runtime_health on public.notification_worker_runtime for select to notification_health_reader using(true);

-- New-object defaults must not give operational authority to unrelated principals.
do $$
declare r record; relation_name text;
begin
  foreach relation_name in array array['notification_org_control','notification_scheduler_cursor','notification_worker_runtime'] loop
    execute format('revoke all on table public.%I from public',relation_name);
    for r in select rolname from pg_roles where rolname<>current_user loop
      execute format('revoke all on table public.%I from %I',relation_name,r.rolname);
    end loop;
  end loop;
end $$;
grant select,insert on public.notification_org_control to notification_coordinator;
grant update(state,generation,owner_id,claimed_at,lease_expires_at,hard_deadline,renewal_count,next_due_at,
  failure_streak,last_failure_code,last_result,last_completed_at,last_success_at) on public.notification_org_control to notification_coordinator;
grant select on public.notification_scheduler_cursor,public.notification_worker_runtime to notification_coordinator;
grant update(pending_after_org,processing_after_org,next_state,tick_generation) on public.notification_scheduler_cursor to notification_coordinator;
grant update(generation,owner_id,lease_expires_at,last_heartbeat_at,started_at,stopped_at,build_sha,catalog_revision,
  catalog_sha256,projector_revision,projector_sha256,admission_generation,admission_owner_id,admission_checked_at,
  admission_code,admission_build_sha,admission_artifact_sha256,admission_catalog_revision,admission_catalog_sha256,admission_projector_revision,admission_projector_sha256)
  on public.notification_worker_runtime to notification_coordinator;
grant select(organization_id,state,catalog_revision,lease_expires_at) on public.notification_outbox to notification_coordinator;
grant select(organization_id,state,catalog_revision,enqueued_at,event_id) on public.notification_outbox to notification_health_reader;
grant select(organization_id,state,next_due_at,failure_streak,last_failure_code,last_result,last_completed_at,last_success_at)
  on public.notification_org_control to notification_health_reader;
grant select(singleton,schema_version,generation,owner_id,lease_expires_at,last_heartbeat_at,started_at,stopped_at,
  build_sha,catalog_revision,catalog_sha256,projector_revision,projector_sha256,admission_generation,
  admission_checked_at,admission_code,admission_build_sha,admission_artifact_sha256,admission_catalog_revision,admission_catalog_sha256,
  admission_projector_revision,admission_projector_sha256) on public.notification_worker_runtime to notification_health_reader;

create index notification_running_control_idx on public.notification_org_control(lease_expires_at,organization_id) where state='running';

create function public.notification_runtime_transition_guard() returns trigger
language plpgsql set search_path='' as $$
declare now_at timestamptz:=clock_timestamp(); owner_text text:=current_setting('app.notification_runtime_owner',true);
  generation_text text:=current_setting('app.notification_runtime_generation',true);
  admission_fields text[]:=array['admission_generation','admission_owner_id','admission_checked_at','admission_code',
    'admission_build_sha','admission_artifact_sha256','admission_catalog_revision','admission_catalog_sha256','admission_projector_revision','admission_projector_sha256'];
begin
  if tg_op<>'UPDATE' or current_user<>'notification_coordinator'
    or not coalesce(owner_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
    or new.singleton is distinct from old.singleton or new.schema_version is distinct from old.schema_version then
    raise exception 'Notification runtime transition is forbidden';
  end if;
  if new.admission_generation is distinct from old.admission_generation then
    if (to_jsonb(new)-admission_fields) is distinct from (to_jsonb(old)-admission_fields)
      or new.admission_generation::numeric<>old.admission_generation::numeric+1
      or new.admission_owner_id::text is distinct from owner_text
      or new.admission_checked_at is null or new.admission_checked_at<statement_timestamp() or new.admission_checked_at>now_at
      or old.lease_expires_at>now_at or old.admission_checked_at>now_at-interval '30 seconds' then
      raise exception 'Notification admission observation is invalid';
    end if;
    return new;
  end if;
  if row(new.admission_generation,new.admission_owner_id,new.admission_checked_at,new.admission_code,
      new.admission_build_sha,new.admission_artifact_sha256,new.admission_catalog_revision,new.admission_catalog_sha256,new.admission_projector_revision,new.admission_projector_sha256)
    is distinct from row(old.admission_generation,old.admission_owner_id,old.admission_checked_at,old.admission_code,
      old.admission_build_sha,old.admission_artifact_sha256,old.admission_catalog_revision,old.admission_catalog_sha256,old.admission_projector_revision,old.admission_projector_sha256) then
    raise exception 'Notification admission evidence changed outside its generation';
  end if;
  if new.generation::numeric=old.generation::numeric+1 then
    if old.lease_expires_at>now_at or new.owner_id::text is distinct from owner_text
      or new.started_at is null or new.started_at<statement_timestamp() or new.started_at>now_at
      or new.last_heartbeat_at is distinct from new.started_at or new.stopped_at is not null then
      raise exception 'Notification runtime acquisition is invalid';
    end if;
    return new;
  end if;
  if new.generation<>old.generation or old.generation::text is distinct from generation_text
    or old.owner_id::text is distinct from owner_text or old.lease_expires_at is null or old.lease_expires_at<=now_at
    or new.started_at is distinct from old.started_at or new.build_sha is distinct from old.build_sha
    or new.catalog_revision is distinct from old.catalog_revision or new.catalog_sha256 is distinct from old.catalog_sha256
    or new.projector_revision is distinct from old.projector_revision or new.projector_sha256 is distinct from old.projector_sha256 then
    raise exception 'Notification runtime lease is stale';
  end if;
  if new.owner_id is null then
    if new.lease_expires_at is not null or new.last_heartbeat_at is distinct from old.last_heartbeat_at
      or new.stopped_at is null or new.stopped_at<statement_timestamp() or new.stopped_at>now_at then
      raise exception 'Notification runtime release is invalid';
    end if;
  elsif new.owner_id is distinct from old.owner_id or new.stopped_at is not null
    or new.last_heartbeat_at is null or new.last_heartbeat_at<statement_timestamp() or new.last_heartbeat_at>now_at
    or new.last_heartbeat_at<old.last_heartbeat_at then
    raise exception 'Notification runtime heartbeat is invalid';
  end if;
  return new;
end $$;
create trigger notification_runtime_transition before insert or update or delete on public.notification_worker_runtime
  for each row execute function public.notification_runtime_transition_guard();

-- Both cursor publication and organization transitions require the live global lease.
-- The coordinator also locks/checks this singleton before every transaction's final write.
create function public.notification_scheduler_fence() returns boolean
language sql volatile set search_path='' as $$
  select exists(select 1 from public.notification_worker_runtime
    where singleton and schema_version=1
      and owner_id::text=current_setting('app.notification_runtime_owner',true)
      and generation::text=current_setting('app.notification_runtime_generation',true)
      and lease_expires_at>clock_timestamp())
$$;

create function public.notification_cursor_transition_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op<>'UPDATE' or current_user<>'notification_coordinator' or not public.notification_scheduler_fence()
    or new.singleton is distinct from old.singleton or new.schema_version is distinct from old.schema_version
    or new.tick_generation::numeric<>old.tick_generation::numeric+1 then
    raise exception 'Notification cursor transition is forbidden';
  end if;
  return new;
end $$;
create trigger notification_cursor_transition before insert or update or delete on public.notification_scheduler_cursor
  for each row execute function public.notification_cursor_transition_guard();

create function public.notification_control_transition_guard() returns trigger
language plpgsql set search_path='' as $$
declare now_at timestamptz:=clock_timestamp(); owner_text text:=current_setting('app.notification_runtime_owner',true);
  backoff_seconds integer; running_count integer;
begin
  if tg_op='DELETE' or current_user<>'notification_coordinator' or not public.notification_scheduler_fence() then
    raise exception 'Notification organization transition is forbidden';
  end if;
  if tg_op='INSERT' then
    if new.state<>'idle' or new.generation<>0 or new.failure_streak<>0 or new.last_result is not null
      or new.last_completed_at is not null or new.last_success_at is not null then
      raise exception 'Notification organization initial state is invalid';
    end if;
    new.next_due_at:=now_at;
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Notification organization identity is immutable';
  end if;
  -- An indexed discovery observation may postpone an idle unsupported/empty org
  -- without claiming work, publishing completion, or changing its failure streak.
  if old.state='idle' and new.state='idle' and new.generation=old.generation then
    if old.next_due_at>now_at or new.last_result not in ('empty','unsupported')
      or new.last_result is null or new.next_due_at<statement_timestamp()+interval '5 seconds'
      or new.next_due_at>now_at+interval '5 seconds'
      or (to_jsonb(new)-array['next_due_at','last_result']) is distinct from (to_jsonb(old)-array['next_due_at','last_result']) then
      raise exception 'Notification idle observation is invalid';
    end if;
    return new;
  end if;
  if old.state='idle' or old.lease_expires_at<=now_at then
    select count(*) into running_count from (
      select organization_id from public.notification_org_control
      where state='running' and lease_expires_at>now_at order by lease_expires_at,organization_id limit 4
    ) admitted;
    if running_count>=4 or old.next_due_at>now_at or new.state<>'running'
      or new.generation::numeric<>old.generation::numeric+1 or new.owner_id::text is distinct from owner_text
      or new.claimed_at is null or new.claimed_at<statement_timestamp() or new.claimed_at>now_at
      or new.lease_expires_at is distinct from new.claimed_at+interval '30 seconds' or new.renewal_count<>0
      or new.next_due_at is distinct from old.next_due_at or new.failure_streak<>old.failure_streak
      or new.last_failure_code is distinct from old.last_failure_code or new.last_result is distinct from old.last_result
      or new.last_completed_at is distinct from old.last_completed_at or new.last_success_at is distinct from old.last_success_at then
      raise exception 'Notification organization claim is invalid';
    end if;
    return new;
  end if;
  if old.owner_id::text is distinct from owner_text or old.generation::text is distinct from current_setting('app.notification_org_generation',true)
    or new.generation<>old.generation or old.lease_expires_at<=now_at then
    raise exception 'Notification organization lease is stale';
  end if;
  if new.state='running' then
    if new.owner_id is distinct from old.owner_id or new.claimed_at is distinct from old.claimed_at
      or new.hard_deadline is distinct from old.hard_deadline or old.renewal_count<>0 or new.renewal_count<>1
      or new.lease_expires_at is distinct from old.hard_deadline
      or (to_jsonb(new)-array['renewal_count','lease_expires_at']) is distinct from (to_jsonb(old)-array['renewal_count','lease_expires_at']) then
      raise exception 'Notification organization renewal is invalid';
    end if;
    return new;
  end if;
  -- Quiesce can race a COMMIT already sent by discovery. Release only the exact
  -- still-live unstarted claim, preserving all projection completion history.
  if current_setting('app.notification_abandon_unstarted',true)='1' then
    if new.state<>'idle' or new.next_due_at<statement_timestamp() or new.next_due_at>now_at
      or (to_jsonb(new)-array['state','owner_id','claimed_at','lease_expires_at','hard_deadline','renewal_count','next_due_at'])
        is distinct from (to_jsonb(old)-array['state','owner_id','claimed_at','lease_expires_at','hard_deadline','renewal_count','next_due_at']) then
      raise exception 'Notification unstarted claim release is invalid';
    end if;
    return new;
  end if;
  if new.last_completed_at is null or new.last_completed_at<statement_timestamp() or new.last_completed_at>now_at then
    raise exception 'Notification organization completion is invalid';
  end if;
  if new.last_result='failed' then
    backoff_seconds:=(array[5,30,120,300])[least(old.failure_streak+1,4)];
    if new.failure_streak<>least(old.failure_streak+1,4) or new.last_failure_code is null
      or new.next_due_at is distinct from new.last_completed_at+make_interval(secs=>backoff_seconds)
      or new.last_success_at is distinct from old.last_success_at then
      raise exception 'Notification failure backoff is invalid';
    end if;
  elsif new.last_result='completed' then
    if new.failure_streak<>0 or new.last_failure_code is not null
      or new.last_success_at is distinct from new.last_completed_at or new.next_due_at is distinct from new.last_completed_at then
      raise exception 'Notification successful completion is invalid';
    end if;
  elsif new.last_result in ('empty','unsupported') then
    if new.failure_streak<>old.failure_streak or new.last_failure_code is distinct from old.last_failure_code
      or new.last_success_at is distinct from old.last_success_at
      or new.next_due_at is distinct from new.last_completed_at+interval '5 seconds' then
      raise exception 'Notification empty backoff is invalid';
    end if;
  else raise exception 'Notification completion result is invalid';
  end if;
  return new;
end $$;
create trigger notification_control_transition before insert or update or delete on public.notification_org_control
  for each row execute function public.notification_control_transition_guard();

do $$
declare r record; function_name text;
begin
  foreach function_name in array array['notification_outbox_provenance_guard','notification_runtime_transition_guard',
    'notification_scheduler_fence','notification_cursor_transition_guard','notification_control_transition_guard'] loop
    execute format('revoke all on function public.%I() from public',function_name);
    for r in select rolname from pg_roles where rolname<>current_user loop
      execute format('revoke all on function public.%I() from %I',function_name,r.rolname);
    end loop;
  end loop;
end $$;
grant execute on function public.notification_scheduler_fence() to notification_coordinator;

-- TODO(handoff): Register and qualify the real Slice5 projector before enabling the
-- production notification worker. See meta proposals/2026-10-03-notification-recon.md.
