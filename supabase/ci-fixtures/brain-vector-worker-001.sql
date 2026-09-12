begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = public, pg_catalog;

-- Hub owns the canonical knowledge_chunks, generation, outbox, and base RPC
-- schema. This migration is an additive serving-worker upgrade only.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'brain_vector_worker'
  ) then
    raise exception 'brain_vector_worker is missing; apply the Hub vector outbox migration first';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'brain_vector_worker'
      and (
        rolinherit
        or rolsuper
        or rolcreatedb
        or rolcreaterole
        or rolreplication
        or rolbypassrls
      )
  ) then
    -- Preserve LOGIN/NOLOGIN topology. Provisioning owns credentials; this
    -- migration only removes unsafe capabilities.
    alter role brain_vector_worker
      noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

do $$
declare
  membership record;
begin
  for membership in
    select granted.rolname
    from pg_catalog.pg_auth_members membership_row
    join pg_catalog.pg_roles granted on granted.oid = membership_row.roleid
    join pg_catalog.pg_roles recipient on recipient.oid = membership_row.member
    where recipient.rolname = 'brain_vector_worker'
  loop
    execute format('revoke %I from brain_vector_worker', membership.rolname);
  end loop;
end
$$;

alter table public.brain_vector_reconcile_state
  add column if not exists qdrant_after_offset jsonb;

drop function if exists public.load_brain_vector_reconcile_cursor(text);
create function public.load_brain_vector_reconcile_cursor(p_generation text)
returns table (
  after_chunk_id uuid,
  qdrant_after_offset jsonb
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select s.after_chunk_id, s.qdrant_after_offset
  from public.brain_vector_reconcile_state s
  where s.collection_generation = p_generation;
$$;

drop function if exists public.save_brain_vector_reconcile_cursor(
  text, uuid, integer, integer, integer, integer, boolean
);
drop function if exists public.save_brain_vector_reconcile_cursor(
  text, uuid, jsonb, integer, integer, integer, integer, boolean
);
create function public.save_brain_vector_reconcile_cursor(
  p_generation text,
  next_chunk_id uuid,
  next_qdrant_offset jsonb,
  scanned_delta integer,
  repaired_delta integer,
  orphaned_delta integer,
  failed_delta integer,
  cycle_complete boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if least(scanned_delta, repaired_delta, orphaned_delta, failed_delta) < 0 then
    raise exception 'reconcile deltas must be nonnegative';
  end if;

  insert into public.brain_vector_reconcile_state as s (
    collection_generation, after_chunk_id, qdrant_after_offset,
    cycle_started_at, last_completed_at, scanned, repaired, orphaned, failed,
    updated_at
  ) values (
    p_generation,
    case when cycle_complete then null else next_chunk_id end,
    case when cycle_complete then null else next_qdrant_offset end,
    case when cycle_complete then null else now() end,
    case when cycle_complete then now() else null end,
    case when cycle_complete then 0 else scanned_delta end,
    case when cycle_complete then 0 else repaired_delta end,
    case when cycle_complete then 0 else orphaned_delta end,
    case when cycle_complete then 0 else failed_delta end,
    now()
  )
  on conflict (collection_generation) do update
  set after_chunk_id = case when cycle_complete then null else next_chunk_id end,
      qdrant_after_offset = case when cycle_complete then null else next_qdrant_offset end,
      cycle_started_at = case
        when cycle_complete then null
        else coalesce(s.cycle_started_at, now())
      end,
      last_completed_at = case when cycle_complete then now() else s.last_completed_at end,
      scanned = case when cycle_complete then 0 else s.scanned + scanned_delta end,
      repaired = case when cycle_complete then 0 else s.repaired + repaired_delta end,
      orphaned = case when cycle_complete then 0 else s.orphaned + orphaned_delta end,
      failed = case when cycle_complete then 0 else s.failed + failed_delta end,
      updated_at = now();
  return true;
end;
$$;

-- Reset direct routine grants before installing the exact worker capability
-- set. PUBLIC/Hub application roles remain explicitly denied.
do $$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure::text as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and acl.grantee = (
        select oid from pg_catalog.pg_roles where rolname = 'brain_vector_worker'
      )
      and acl.privilege_type = 'EXECUTE'
  loop
    execute format(
      'revoke all privileges on function %s from brain_vector_worker',
      routine.signature
    );
  end loop;
end
$$;

-- The claim reader is re-signed below (generation-scoped), so this pass must
-- tolerate whichever arity the database currently carries.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.claim_brain_vector_jobs(text, integer, integer)',
    'public.claim_brain_vector_jobs(text, text, integer, integer)'
  ] loop
    if pg_catalog.to_regprocedure(signature) is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated, app_ledger', signature
      );
      execute format('grant execute on function %s to brain_vector_worker', signature);
    end if;
  end loop;
end
$$;

revoke all on function public.ack_brain_vector_job(uuid, text, bigint)
  from public, anon, authenticated, app_ledger;
revoke all on function public.retry_brain_vector_job(
  uuid, text, bigint, text, timestamptz
) from public, anon, authenticated, app_ledger;
revoke all on function public.dead_letter_brain_vector_job(uuid, text, bigint, text)
  from public, anon, authenticated, app_ledger;
revoke all on function public.list_brain_vector_chunks(uuid, integer, text)
  from public, anon, authenticated, app_ledger;
revoke all on function public.filter_existing_brain_vector_chunks(uuid[], text)
  from public, anon, authenticated, app_ledger;
revoke all on function public.load_brain_vector_reconcile_cursor(text)
  from public, anon, authenticated, app_ledger;
revoke all on function public.save_brain_vector_reconcile_cursor(
  text, uuid, jsonb, integer, integer, integer, integer, boolean
) from public, anon, authenticated, app_ledger;
revoke all on function public.enqueue_brain_vector_backfill(text, uuid, integer)
  from public, anon, authenticated, app_ledger;
revoke all on function public.brain_vector_worker_status(text)
  from public, anon, authenticated, app_ledger;

grant execute on function public.ack_brain_vector_job(uuid, text, bigint)
  to brain_vector_worker;
grant execute on function public.retry_brain_vector_job(
  uuid, text, bigint, text, timestamptz
) to brain_vector_worker;
grant execute on function public.dead_letter_brain_vector_job(uuid, text, bigint, text)
  to brain_vector_worker;
grant execute on function public.list_brain_vector_chunks(uuid, integer, text)
  to brain_vector_worker;
grant execute on function public.filter_existing_brain_vector_chunks(uuid[], text)
  to brain_vector_worker;
grant execute on function public.load_brain_vector_reconcile_cursor(text)
  to brain_vector_worker;
grant execute on function public.save_brain_vector_reconcile_cursor(
  text, uuid, jsonb, integer, integer, integer, integer, boolean
) to brain_vector_worker;
grant execute on function public.enqueue_brain_vector_backfill(text, uuid, integer)
  to brain_vector_worker;
grant execute on function public.brain_vector_worker_status(text)
  to brain_vector_worker;

commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = public, pg_catalog;

-- Qdrant-owned generations keep canonical text and metadata in Postgres, but
-- vectors are generated and retained by the serving worker. Existing
-- generations remain pgvector-owned until the operator flips this gate after
-- per-org collections have passed parity.
alter table public.brain_vector_generations
  add column if not exists storage_mode text not null default 'pgvector';

alter table public.brain_vector_generations
  drop constraint if exists brain_vector_generations_storage_mode_check;
alter table public.brain_vector_generations
  add constraint brain_vector_generations_storage_mode_check
  check (storage_mode in ('pgvector', 'qdrant'));

create or replace function public.enqueue_brain_vector_chunk()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.brain_vector_generations%rowtype;
  operation text;
  chunk_uuid uuid;
  chunk_org text;
  chunk_hash text;
begin
  select * into target
  from public.brain_vector_generations
  where is_active and enqueue_enabled
  limit 1;

  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'UPDATE'
     and new.content_hash is not distinct from old.content_hash
     and new.org_id is not distinct from old.org_id
     and new.source_id is not distinct from old.source_id
     and new.document_id is not distinct from old.document_id
     and new.kind is not distinct from old.kind
     and new.occurred_at is not distinct from old.occurred_at
     and (
       target.storage_mode = 'qdrant'
       or (
         new.embedding_model is not distinct from old.embedding_model
         and new.embedding is not distinct from old.embedding
       )
     ) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    operation := 'delete';
    chunk_uuid := old.id;
    chunk_org := old.org_id;
    chunk_hash := old.content_hash;
  elsif target.storage_mode = 'qdrant' then
    operation := 'upsert';
    chunk_uuid := new.id;
    chunk_org := new.org_id;
    chunk_hash := new.content_hash;
  elsif tg_op = 'INSERT' and (
    new.embedding is null or new.embedding_model is distinct from target.embedding_model
  ) then
    return new;
  elsif new.embedding is null or new.embedding_model is distinct from target.embedding_model then
    operation := 'delete';
    chunk_uuid := new.id;
    chunk_org := new.org_id;
    chunk_hash := new.content_hash;
  else
    operation := 'upsert';
    chunk_uuid := new.id;
    chunk_org := new.org_id;
    chunk_hash := new.content_hash;
  end if;

  insert into public.brain_vector_outbox (
    chunk_id, org_id, collection_generation, desired_operation,
    desired_content_hash, revision, status, attempts, available_at,
    lease_owner, lease_until, last_error, updated_at
  ) values (
    chunk_uuid, chunk_org, target.generation, operation,
    chunk_hash, 1, 'queued', 0, now(), null, null, null, now()
  )
  on conflict (chunk_id, collection_generation) do update set
    org_id = excluded.org_id,
    desired_operation = excluded.desired_operation,
    desired_content_hash = excluded.desired_content_hash,
    revision = public.brain_vector_outbox.revision + 1,
    status = 'queued',
    attempts = 0,
    available_at = now(),
    lease_owner = null,
    lease_until = null,
    last_error = null,
    updated_at = now();

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop function if exists public.claim_brain_vector_jobs(text, integer, integer);
drop function if exists public.claim_brain_vector_jobs(text, text, integer, integer);
-- Outbox rows are partitioned by generation and every worker is pinned to one.
-- Claiming across that boundary would hand a job to a worker that can only
-- dead-letter it, so the partition is enforced in the claim itself.
create function public.claim_brain_vector_jobs(
  p_generation text,
  worker_id text,
  job_limit integer default 100,
  lease_seconds integer default 60
)
returns table (
  chunk_id uuid,
  org_id text,
  generation text,
  operation text,
  revision bigint,
  attempts integer,
  source_id uuid,
  document_id uuid,
  kind text,
  occurred_at timestamptz,
  content_hash text,
  embedding_model text,
  embedding text,
  chunk_text text,
  context_prefix text
)
language sql
security definer
set search_path = pg_catalog, public
set statement_timeout = '15s'
as $$
  with claimed as (
    select o.chunk_id, o.collection_generation
    from public.brain_vector_outbox o
    where o.collection_generation = p_generation
    and (
      (o.status = 'queued' and o.available_at <= now())
      or (o.status = 'running' and o.lease_until < now())
    )
    order by o.available_at, o.updated_at, o.chunk_id
    for update skip locked
    limit least(greatest(job_limit, 1), 500)
  ), leased as (
    update public.brain_vector_outbox o
    set status = 'running',
        attempts = o.attempts + 1,
        lease_owner = left(worker_id, 200),
        lease_until = now() + make_interval(secs => least(greatest(lease_seconds, 10), 900)),
        updated_at = now()
    from claimed c
    where o.chunk_id = c.chunk_id
      and o.collection_generation = c.collection_generation
    returning o.*
  )
  select
    l.chunk_id,
    l.org_id,
    l.collection_generation,
    case when k.id is null then 'delete' else l.desired_operation end,
    l.revision,
    l.attempts,
    k.source_id,
    k.document_id,
    k.kind,
    k.occurred_at,
    k.content_hash,
    g.embedding_model,
    k.embedding::text,
    k.chunk_text,
    k.context_prefix
  from leased l
  join public.brain_vector_generations g
    on g.generation = l.collection_generation
  left join public.knowledge_chunks k
    on k.id = l.chunk_id and k.org_id = l.org_id;
$$;

create or replace function public.ack_brain_vector_job(
  chunk_id uuid,
  generation text,
  revision bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  acked public.brain_vector_outbox%rowtype;
  indexed_hash text;
  indexed_generation text;
begin
  delete from public.brain_vector_outbox o
  where o.chunk_id = ack_brain_vector_job.chunk_id
    and o.collection_generation = ack_brain_vector_job.generation
    and o.revision = ack_brain_vector_job.revision
    and o.status = 'running'
  returning o.* into acked;

  if not found then
    return false;
  end if;

  indexed_hash := case
    when acked.desired_operation = 'upsert' then acked.desired_content_hash
  end;
  indexed_generation := case
    when acked.desired_operation = 'upsert' then acked.collection_generation
  end;

  update public.knowledge_chunks k
  set vector_indexed_hash = indexed_hash,
      vector_indexed_generation = indexed_generation
  where k.id = ack_brain_vector_job.chunk_id
    and k.org_id = acked.org_id
    and (
      k.vector_indexed_hash is distinct from indexed_hash
      or k.vector_indexed_generation is distinct from indexed_generation
    );

  update public.knowledge_chunks k
  set embedding = null, embedding_model = null, updated_at = now()
  from public.brain_vector_generations g
  where g.generation = ack_brain_vector_job.generation
    and g.is_active
    and g.storage_mode = 'qdrant'
    and k.id = ack_brain_vector_job.chunk_id
    and k.org_id = acked.org_id
    and (k.embedding is not null or k.embedding_model is not null);

  return true;
end;
$$;

drop function if exists public.list_brain_vector_chunks(uuid, integer, text);
create function public.list_brain_vector_chunks(
  after_chunk_id uuid default null,
  row_limit integer default 500,
  generation text default 'openai_te3s_1536_g1'
)
returns table (
  chunk_id uuid,
  org_id text,
  generation text,
  source_id uuid,
  document_id uuid,
  kind text,
  occurred_at timestamptz,
  content_hash text,
  embedding_model text,
  embedding text,
  chunk_text text,
  context_prefix text
)
language sql
security definer
set search_path = pg_catalog, public
set statement_timeout = '15s'
as $$
  select k.id, k.org_id, g.generation, k.source_id, k.document_id, k.kind, k.occurred_at,
         k.content_hash, g.embedding_model, k.embedding::text, k.chunk_text, k.context_prefix
  from public.knowledge_chunks k
  join public.brain_vector_generations g
    on g.generation = list_brain_vector_chunks.generation
  where (g.storage_mode = 'qdrant' or (
      k.embedding is not null and k.embedding_model = g.embedding_model
    ))
    and (after_chunk_id is null or k.id > after_chunk_id)
  order by k.id
  limit least(greatest(row_limit, 1), 1000);
$$;

create or replace function public.filter_existing_brain_vector_chunks(
  chunk_ids uuid[],
  generation text
)
returns table (
  chunk_id uuid,
  org_id text,
  content_hash text,
  embedding_model text
)
language plpgsql
security definer
set search_path = pg_catalog, public
set statement_timeout = '10s'
as $$
begin
  if cardinality(chunk_ids) > 1000 then
    raise exception 'filter_existing_brain_vector_chunks accepts at most 1000 chunk IDs'
      using errcode = '22023';
  end if;

  return query
  select k.id, k.org_id, k.content_hash, g.embedding_model
  from public.knowledge_chunks k
  join public.brain_vector_generations g
    on g.generation = filter_existing_brain_vector_chunks.generation
  where cardinality(chunk_ids) >= 1
    and k.id = any(chunk_ids)
    and (g.storage_mode = 'qdrant' or (
      k.embedding is not null and k.embedding_model = g.embedding_model
    ))
  order by k.id;
end;
$$;

create or replace function public.enqueue_brain_vector_backfill(
  generation text,
  after_chunk_id uuid default null,
  row_limit integer default 500
)
returns table (enqueued integer, next_chunk_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
set statement_timeout = '20s'
as $$
declare
  changed integer := 0;
  cursor_id uuid;
begin
  with page as materialized (
    select k.id, k.org_id, k.content_hash
    from public.knowledge_chunks k
    join public.brain_vector_generations g
      on g.generation = enqueue_brain_vector_backfill.generation
     and g.enqueue_enabled
    where (g.storage_mode = 'qdrant' or (
        k.embedding is not null and k.embedding_model = g.embedding_model
      ))
      and (after_chunk_id is null or k.id > after_chunk_id)
    order by k.id
    limit least(greatest(row_limit, 1), 1000)
  )
  insert into public.brain_vector_outbox (
    chunk_id, org_id, collection_generation, desired_operation,
    desired_content_hash, revision, status, attempts, available_at,
    lease_owner, lease_until, last_error, updated_at
  )
  select id, org_id, generation, 'upsert', content_hash, 1, 'queued', 0,
         now(), null, null, null, now()
  from page
  on conflict (chunk_id, collection_generation) do update set
    org_id = excluded.org_id,
    desired_operation = 'upsert',
    desired_content_hash = excluded.desired_content_hash,
    revision = public.brain_vector_outbox.revision + 1,
    status = 'queued', attempts = 0, available_at = now(),
    lease_owner = null, lease_until = null, last_error = null, updated_at = now()
  where public.brain_vector_outbox.desired_operation <> 'upsert'
     or public.brain_vector_outbox.desired_content_hash is distinct from excluded.desired_content_hash;
  get diagnostics changed = row_count;

  select page.id into cursor_id
  from (
    select k.id
    from public.knowledge_chunks k
    join public.brain_vector_generations g
      on g.generation = enqueue_brain_vector_backfill.generation
     and g.enqueue_enabled
    where (g.storage_mode = 'qdrant' or (
        k.embedding is not null and k.embedding_model = g.embedding_model
      ))
      and (after_chunk_id is null or k.id > after_chunk_id)
    order by k.id
    limit least(greatest(row_limit, 1), 1000)
  ) page
  order by page.id desc
  limit 1;

  return query select changed, cursor_id;
end;
$$;

create or replace function public.brain_vector_worker_status(p_generation text)
returns table (
  queued bigint,
  running bigint,
  dead bigint,
  oldest_queued_at timestamptz,
  canonical_chunks bigint,
  last_reconcile_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set statement_timeout = '15s'
as $$
begin
  if not exists (
    select 1 from public.brain_vector_generations g where g.generation = p_generation
  ) then
    raise exception 'unknown brain vector generation: %', p_generation using errcode = '22023';
  end if;

  return query
  select
    count(*) filter (where o.status = 'queued')::bigint,
    count(*) filter (where o.status = 'running')::bigint,
    count(*) filter (where o.status = 'dead')::bigint,
    min(o.available_at) filter (where o.status = 'queued'),
    (
      select count(*)::bigint
      from public.knowledge_chunks k
      join public.brain_vector_generations g on g.generation = p_generation
      where g.storage_mode = 'qdrant'
         or (k.embedding is not null and k.embedding_model = g.embedding_model)
    ),
    (
      select s.last_completed_at
      from public.brain_vector_reconcile_state s
      where s.collection_generation = p_generation
    )
  from public.brain_vector_outbox o
  where o.collection_generation = p_generation;
end;
$$;

revoke all on function public.claim_brain_vector_jobs(text, text, integer, integer)
  from public, anon, authenticated, app_ledger;
revoke all on function public.list_brain_vector_chunks(uuid, integer, text)
  from public, anon, authenticated, app_ledger;
revoke all on function public.enqueue_brain_vector_chunk()
  from public, anon, authenticated, app_ledger;

grant execute on function public.claim_brain_vector_jobs(text, text, integer, integer)
  to brain_vector_worker;
grant execute on function public.list_brain_vector_chunks(uuid, integer, text)
  to brain_vector_worker;

commit;
