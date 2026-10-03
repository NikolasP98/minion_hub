-- Notification Slice3: immutable event evidence and tenant-scoped projection claims.
-- No delivery worker, HTTP request, provider effect or legacy-table rewrite occurs here.
-- Application roles are cluster objects; reject a pre-existing ambiguous role rather than
-- inheriting its privileges. The ordinary migration runner owns this entire transaction.
do $$
declare role_name text;
begin
  foreach role_name in array array['notification_event_trigger','notification_worker'] loop
    if exists (select 1 from pg_roles where rolname=role_name) then
      raise exception 'Notification role already exists; reviewed role reconciliation required';
    end if;
    execute format('create role %I nologin nosuperuser nobypassrls noinherit nocreatedb nocreaterole noreplication',role_name);
  end loop;
  if not exists (select 1 from pg_roles where rolname='app_ledger' and not rolsuper and not rolbypassrls) then
    raise exception 'Notification producer role is unavailable or bypasses RLS';
  end if;
  if current_user in ('app_ledger','anon','authenticated','service_role','app_assistant_ro') then
    raise exception 'Notification migration requires the trusted backend owner';
  end if;
  -- A browser/service role must never be able to assume the backend login, even indirectly.
  if exists (select 1 from pg_roles r where r.rolname in
    ('app_ledger','anon','authenticated','service_role','app_assistant_ro')
    and pg_has_role(r.oid,current_user,'MEMBER')) then
    raise exception 'Notification backend owner is reachable from an application role';
  end if;
  -- A NOSUPERUSER migration owner must be able to transfer only the trigger
  -- function while installing it. The membership is revoked immediately after
  -- the ownership change; it is never retained as runtime authority.
  execute format('grant notification_event_trigger to %I',current_user);
  execute format('grant notification_worker to %I',current_user);
end $$;

grant usage on schema public to notification_event_trigger, notification_worker;

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  kind text not null check (octet_length(kind) between 1 and 96 and kind ~ '^[a-z][a-z0-9_.]*$'),
  schema_version integer not null check (schema_version between 1 and 65535),
  catalog_revision text collate "C" not null check (octet_length(catalog_revision) between 1 and 64 and catalog_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]*$'),
  producer_id text not null check (octet_length(producer_id) between 1 and 96 and producer_id ~ '^[a-z][a-z0-9_.]*$'),
  subject_type text not null check (octet_length(subject_type) between 1 and 48 and subject_type ~ '^[a-z][a-z0-9_]*$'),
  subject_id uuid not null,
  subject_revision text not null check (octet_length(subject_revision) between 1 and 128 and subject_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]*$'),
  source_identity text not null check (octet_length(source_identity) between 1 and 128 and source_identity ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]*$'),
  occurred_at timestamptz not null check (isfinite(occurred_at) and occurred_at >= '0001-01-01T00:00:00Z' and occurred_at < '10000-01-01T00:00:00Z'),
  dedupe_key text not null check (octet_length(dedupe_key) between 1 and 256 and dedupe_key ~ '^[A-Za-z0-9][A-Za-z0-9._:+-]*$'),
  payload_canonical text not null check (octet_length(payload_canonical) <= 32768 and jsonb_typeof(payload_canonical::jsonb)='object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$' and payload_sha256=encode(sha256(convert_to(payload_canonical,'UTF8')),'hex')),
  semantic_sha256 text not null check (semantic_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  source_transaction_id text not null default pg_current_xact_id()::text check (source_transaction_id ~ '^[0-9]{1,20}$'),
  check ((kind,producer_id,subject_type) in (
    ('agent.report.ready','agent.report','report_snapshot'),
    ('agent.user_notice','agent.notice','notice_snapshot'),
    ('automation.effects.committed','automation.effects','automation_run'),
    ('automation.run.failed','automation.run','automation_run'),
    ('automation.schedule.committed','automation.schedule','automation_schedule'),
    ('domain.status.changed','scheduling.status','booking'),
    ('finance.daily_summary.ready','finance.daily_summary','finance_snapshot'),
    ('join.approved','membership.join','join_request'),
    ('join.denied','membership.join','join_request'),
    ('join.requested','membership.join','join_request'),
    ('membership.activated','membership.activation','member'),
    ('release.gateway.available','release.gateway','gateway_release'),
    ('release.product.published','release.product','product_release'),
    ('scheduling.booking.upcoming','scheduling.reminder','booking'),
    ('stock.daily_summary.ready','stock.daily_summary','stock_snapshot'),
    ('stock.low.crossed','stock.threshold','stock_item')
  )),
  unique (organization_id,producer_id,dedupe_key),
  unique (organization_id,id,catalog_revision)
);

create table public.notification_outbox (
  event_id uuid primary key,
  organization_id uuid not null,
  catalog_revision text collate "C" not null,
  state text not null default 'pending' check (state in ('pending','processing','projected','quarantined')),
  lease_owner uuid,
  generation bigint not null default 0 check (generation >= 0),
  claimed_at timestamptz,
  hard_deadline timestamptz,
  lease_expires_at timestamptz,
  renewal_count integer,
  claim_count bigint not null default 0 check (claim_count >= 0),
  completed_at timestamptz,
  quarantine_reason text check (quarantine_reason in ('payload_invalid','digest_mismatch','envelope_invalid') and octet_length(quarantine_reason)<=32),
  foreign key (organization_id,event_id,catalog_revision) references public.notification_events(organization_id,id,catalog_revision) on delete restrict,
  check ((state='processing' and lease_owner is not null and claimed_at is not null and hard_deadline is not null and renewal_count is not null and hard_deadline=claimed_at+interval '60 seconds' and lease_expires_at is not null and lease_expires_at>claimed_at and lease_expires_at<=hard_deadline and renewal_count in (0,1)) or
    (state<>'processing' and lease_owner is null and claimed_at is null and hard_deadline is null and lease_expires_at is null and renewal_count is null)),
  check ((state in ('projected','quarantined'))=(completed_at is not null)),
  check ((state='quarantined')=(quarantine_reason is not null)),
  check (state<>'pending' or (generation=0 and claim_count=0)),
  check (state='pending' or (generation>0 and claim_count=generation))
);

create index notification_pending_claim_idx on public.notification_outbox(organization_id,catalog_revision collate "C",event_id) where state='pending';
create index notification_expired_claim_idx on public.notification_outbox(organization_id,catalog_revision collate "C",lease_expires_at,event_id) where state='processing';

alter table public.notification_events enable row level security;
alter table public.notification_events force row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_outbox force row level security;
create policy notification_event_producer on public.notification_events for all to app_ledger
  using (organization_id::text=current_setting('app.current_org_id',true))
  with check (organization_id::text=current_setting('app.current_org_id',true));
create policy notification_event_worker on public.notification_events for select to notification_worker
  using (organization_id::text=current_setting('app.current_org_id',true));
create policy notification_outbox_trigger on public.notification_outbox for insert to notification_event_trigger
  with check (organization_id::text=current_setting('app.current_org_id',true) and state='pending' and generation=0 and claim_count=0);
create policy notification_outbox_worker on public.notification_outbox for all to notification_worker
  using (organization_id::text=current_setting('app.current_org_id',true))
  with check (organization_id::text=current_setting('app.current_org_id',true));

-- Strip default ACLs (including unexpected per-role defaults) from these NEW owned objects.
do $$
declare role_row record; relation_name text;
begin
  foreach relation_name in array array['notification_events','notification_outbox'] loop
    execute format('revoke all on table public.%I from public',relation_name);
    for role_row in select rolname from pg_roles where rolname<>current_user loop
      execute format('revoke all on table public.%I from %I',relation_name,role_row.rolname);
    end loop;
  end loop;
end $$;
grant select,insert on public.notification_events to app_ledger;
grant select on public.notification_events,public.notification_outbox to notification_worker;
grant update (state,lease_owner,generation,claimed_at,hard_deadline,lease_expires_at,renewal_count,claim_count,completed_at,quarantine_reason) on public.notification_outbox to notification_worker;
grant insert on public.notification_outbox to notification_event_trigger;

create function public.notification_event_evidence_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op<>'INSERT' then raise exception 'Notification evidence is immutable'; end if;
  new.created_at:=clock_timestamp();
  new.source_transaction_id:=pg_current_xact_id()::text;
  return new;
end $$;
revoke all on function public.notification_event_evidence_guard() from public;
create trigger notification_event_evidence before insert or update or delete on public.notification_events
  for each row execute function public.notification_event_evidence_guard();

create function public.notification_event_enqueue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_relid<>'public.notification_events'::regclass or tg_table_schema<>'public'
    or tg_table_name<>'notification_events' or tg_op<>'INSERT' or tg_when<>'AFTER' then
    raise exception 'Notification enqueue trigger source is invalid';
  end if;
  insert into public.notification_outbox(event_id,organization_id,catalog_revision)
    values(new.id,new.organization_id,new.catalog_revision);
  return new;
end $$;
-- Transfer only function ownership. The narrowly privileged role never owns either relation.
grant create on schema public to notification_event_trigger;
alter function public.notification_event_enqueue() owner to notification_event_trigger;
revoke create on schema public from notification_event_trigger;
do $$ begin execute format('revoke notification_event_trigger from %I',current_user); end $$;
revoke all on function public.notification_event_enqueue() from public;
create trigger notification_event_outbox after insert on public.notification_events
  for each row execute function public.notification_event_enqueue();

create function public.notification_outbox_transition_guard() returns trigger
language plpgsql set search_path='' as $$
declare now_at timestamptz:=clock_timestamp(); expected_owner text:=current_setting('app.notification_owner',true);
begin
  if tg_op='DELETE' then raise exception 'Notification outbox retention is unavailable'; end if;
  if tg_op='INSERT' then
    if current_user<>'notification_event_trigger' or new.state<>'pending' or new.generation<>0 or new.claim_count<>0 then
      raise exception 'Notification initial claim state is invalid';
    end if;
    return new;
  end if;
  if current_user<>'notification_worker' or new.event_id is distinct from old.event_id
    or new.organization_id is distinct from old.organization_id or new.catalog_revision is distinct from old.catalog_revision
    or old.state in ('projected','quarantined') then raise exception 'Notification claim transition is forbidden'; end if;
  if old.state='pending' or (old.state='processing' and old.lease_expires_at<=now_at) then
    if new.state<>'processing' or new.lease_owner::text is distinct from expected_owner
      or new.generation<>old.generation+1 or new.claim_count<>old.claim_count+1
      or new.renewal_count<>0 or new.claimed_at is null or new.claimed_at>now_at
      or new.claimed_at<statement_timestamp() or new.lease_expires_at<>new.claimed_at+interval '30 seconds'
      or new.hard_deadline<>new.claimed_at+interval '60 seconds' then
      raise exception 'Notification claim admission is invalid';
    end if;
  else
    if old.lease_owner::text is distinct from expected_owner
      or old.generation::text is distinct from current_setting('app.notification_generation',true)
      or old.lease_expires_at<=now_at or new.generation<>old.generation or new.claim_count<>old.claim_count then
      raise exception 'Notification lease is stale';
    end if;
    if new.state='processing' then
      if new.lease_owner<>old.lease_owner or new.claimed_at<>old.claimed_at or new.hard_deadline<>old.hard_deadline
        or old.renewal_count<>0 or new.renewal_count<>1 or new.lease_expires_at<>old.hard_deadline then
        raise exception 'Notification renewal is invalid';
      end if;
    elsif new.state not in ('projected','quarantined') or new.completed_at is null
      or new.completed_at<statement_timestamp() or new.completed_at>now_at then
      raise exception 'Notification settlement is invalid';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.notification_outbox_transition_guard() from public;
create trigger notification_outbox_transition before insert or update or delete on public.notification_outbox
  for each row execute function public.notification_outbox_transition_guard();

-- EXECUTE grants can also arise from database default privileges; no public/application
-- principal needs to call or attach these trigger-only functions.
do $$
declare role_row record; function_name text;
begin
  foreach function_name in array array['notification_event_evidence_guard','notification_event_enqueue','notification_outbox_transition_guard'] loop
    for role_row in select rolname from pg_roles where rolname<>current_user and rolname<>'notification_event_trigger' loop
      execute format('revoke all on function public.%I() from %I',function_name,role_row.rolname);
    end loop;
  end loop;
end $$;
-- TODO(handoff): Wire qualified producers, projection, retention and tenant-deletion reconciliation
-- before this platform receives live events. See meta proposals/2026-10-03-notification-recon.md.

-- Fixed no-data failure. An application caller cannot catch an append conflict/validation
-- exception and still commit its source mutation without the required event evidence.
create function public.notification_event_abort_source_transaction() returns void
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='P0001',message='Notification source transaction must roll back';
end $$;
revoke all on function public.notification_event_abort_source_transaction() from public;
do $$
declare role_row record;
begin
  for role_row in select rolname from pg_roles where rolname<>current_user loop
    execute format('revoke all on function public.notification_event_abort_source_transaction() from %I',role_row.rolname);
  end loop;
end $$;
grant execute on function public.notification_event_abort_source_transaction() to app_ledger;

-- One bounded database call prevents a malformed page from spending hundreds of network
-- round trips and repeatedly rolling back its quarantine at the worker deadline.
-- Invoker authority is exactly the worker's existing constrained transition authority.
create function public.notification_quarantine_claims(claims jsonb) returns integer
language plpgsql set search_path='' as $$
declare claim jsonb; event_ids uuid[]:=array[]::uuid[]; changed integer; total integer:=0;
begin
  if current_user<>'notification_worker' or jsonb_typeof(claims) is distinct from 'array' then
    raise exception 'Notification quarantine batch is invalid';
  end if;
  if jsonb_array_length(claims)<1 or jsonb_array_length(claims)>250
    or octet_length(claims::text)>65536 then
    raise exception 'Notification quarantine batch is invalid';
  end if;
  -- Validate the complete bounded batch before the first transition.
  for claim in select value from jsonb_array_elements(claims) loop
    if jsonb_typeof(claim) is distinct from 'object' then
      raise exception 'Notification quarantine batch is invalid';
    end if;
    if (select array_agg(key order by key) from jsonb_object_keys(claim) key)
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
  for claim in select value from jsonb_array_elements(claims) order by value->>'eventId' collate "C" loop
    perform set_config('app.notification_generation',claim->>'generation',true);
    update public.notification_outbox set state='quarantined',completed_at=clock_timestamp(),
      quarantine_reason=claim->>'reason',lease_owner=null,claimed_at=null,hard_deadline=null,
      lease_expires_at=null,renewal_count=null
      where organization_id::text=current_setting('app.current_org_id',true)
        and event_id=(claim->>'eventId')::uuid and state='processing'
        and lease_owner::text=current_setting('app.notification_owner',true)
        and generation=(claim->>'generation')::bigint and lease_expires_at>clock_timestamp();
    get diagnostics changed=row_count;
    total:=total+changed;
  end loop;
  return total;
end $$;
revoke all on function public.notification_quarantine_claims(jsonb) from public;
do $$
declare role_row record;
begin
  for role_row in select rolname from pg_roles where rolname<>current_user loop
    execute format('revoke all on function public.notification_quarantine_claims(jsonb) from %I',role_row.rolname);
  end loop;
end $$;
grant execute on function public.notification_quarantine_claims(jsonb) to notification_worker;
