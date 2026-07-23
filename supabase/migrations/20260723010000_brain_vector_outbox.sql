-- Durable, forward-safe serving-index outbox for Unified Brains.
--
-- Supabase remains canonical. The trigger is deliberately inert until an
-- operator enables the generation control row after the private worker and
-- Qdrant collection have passed readiness checks.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.brain_vector_generations (
  generation text primary key,
  embedding_model text not null,
  dimensions integer not null,
  enqueue_enabled boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brain_vector_generations_dimensions_check check (dimensions > 0),
  constraint brain_vector_generations_name_check check (generation ~ '^[a-z0-9_]{1,64}$')
);

create unique index if not exists brain_vector_generations_one_active_uniq
  on public.brain_vector_generations (is_active) where is_active;

insert into public.brain_vector_generations
  (generation, embedding_model, dimensions, enqueue_enabled, is_active)
values ('openai_te3s_1536_g1', 'text-embedding-3-small', 1536, false, true)
on conflict (generation) do nothing;

create table if not exists public.brain_vector_outbox (
  chunk_id uuid not null,
  org_id text not null,
  collection_generation text not null,
  desired_operation text not null,
  desired_content_hash text,
  revision bigint not null default 1,
  status text not null default 'queued',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chunk_id, collection_generation),
  constraint brain_vector_outbox_generation_fk foreign key (collection_generation)
    references public.brain_vector_generations (generation),
  constraint brain_vector_outbox_operation_check check (desired_operation in ('upsert', 'delete')),
  constraint brain_vector_outbox_status_check check (status in ('queued', 'running', 'dead')),
  constraint brain_vector_outbox_revision_check check (revision > 0),
  constraint brain_vector_outbox_attempts_check check (attempts >= 0)
);

create index if not exists brain_vector_outbox_claim_idx
  on public.brain_vector_outbox (available_at, updated_at)
  where status = 'queued';
create index if not exists brain_vector_outbox_expired_lease_idx
  on public.brain_vector_outbox (lease_until)
  where status = 'running';
create index if not exists brain_vector_outbox_org_idx
  on public.brain_vector_outbox (org_id, collection_generation);

create table if not exists public.brain_vector_reconcile_state (
  collection_generation text primary key references public.brain_vector_generations (generation),
  after_chunk_id uuid,
  cycle_started_at timestamptz,
  last_completed_at timestamptz,
  scanned bigint not null default 0,
  repaired bigint not null default 0,
  orphaned bigint not null default 0,
  failed bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.brain_vector_reconcile_state (collection_generation)
values ('openai_te3s_1536_g1')
on conflict (collection_generation) do nothing;

alter table public.brain_vector_generations enable row level security;
alter table public.brain_vector_generations force row level security;
alter table public.brain_vector_outbox enable row level security;
alter table public.brain_vector_outbox force row level security;
alter table public.brain_vector_reconcile_state enable row level security;
alter table public.brain_vector_reconcile_state force row level security;

-- No app_ledger policy or table grant is intentional: Hub users and ordinary
-- application transactions cannot inspect or mutate worker coordination state.
revoke all on public.brain_vector_generations from public, anon, authenticated, app_ledger;
revoke all on public.brain_vector_outbox from public, anon, authenticated, app_ledger;
revoke all on public.brain_vector_reconcile_state from public, anon, authenticated, app_ledger;

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

  if tg_op = 'DELETE' then
    operation := 'delete';
    chunk_uuid := old.id;
    chunk_org := old.org_id;
    chunk_hash := old.content_hash;
  elsif tg_op = 'INSERT' and (
    new.embedding is null or new.embedding_model is distinct from target.embedding_model
  ) then
    return new;
  elsif new.embedding is null or new.embedding_model is distinct from target.embedding_model then
    -- An incomplete canonical chunk has no valid serving-index state. If a
    -- prior point exists, delete wins over a formerly queued upsert.
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

  if tg_op = 'UPDATE'
     and new.content_hash is not distinct from old.content_hash
     and new.embedding_model is not distinct from old.embedding_model
     and new.embedding is not distinct from old.embedding
     and new.org_id is not distinct from old.org_id
     and new.source_id is not distinct from old.source_id
     and new.document_id is not distinct from old.document_id
     and new.kind is not distinct from old.kind
     and new.occurred_at is not distinct from old.occurred_at then
    return new;
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

drop trigger if exists knowledge_chunks_vector_outbox on public.knowledge_chunks;
create trigger knowledge_chunks_vector_outbox
after insert or update of content_hash, embedding_model, embedding, org_id, source_id, document_id, kind, occurred_at or delete
on public.knowledge_chunks
for each row execute function public.enqueue_brain_vector_chunk();

-- A NOLOGIN group role is safe to install through migrations. Production
-- provisioning creates a LOGIN role with a rotated password and grants this
-- role to it; no broad service-role credential is required by the worker.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'brain_vector_worker') then
    create role brain_vector_worker nologin noinherit nobypassrls;
  end if;
end
$$;

create or replace function public.claim_brain_vector_jobs(
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
  embedding text
)
language sql
security definer
set search_path = pg_catalog, public
set statement_timeout = '15s'
as $$
  with claimed as (
    select o.chunk_id, o.collection_generation
    from public.brain_vector_outbox o
    where (
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
    l.collection_generation as generation,
    case when k.id is null then 'delete' else l.desired_operation end as operation,
    l.revision,
    l.attempts,
    k.source_id,
    k.document_id,
    k.kind,
    k.occurred_at,
    k.content_hash,
    k.embedding_model,
    k.embedding::text
  from leased l
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
begin
  delete from public.brain_vector_outbox o
  where o.chunk_id = ack_brain_vector_job.chunk_id
    and o.collection_generation = ack_brain_vector_job.generation
    and o.revision = ack_brain_vector_job.revision
    and o.status = 'running';
  return found;
end;
$$;

create or replace function public.retry_brain_vector_job(
  chunk_id uuid,
  generation text,
  revision bigint,
  error text,
  available_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.brain_vector_outbox o
  set status = case when o.attempts >= 8 then 'dead' else 'queued' end,
      available_at = least(greatest(retry_brain_vector_job.available_at, now() + interval '1 second'), now() + interval '24 hours'),
      lease_owner = null,
      lease_until = null,
      last_error = left(retry_brain_vector_job.error, 2000),
      updated_at = now()
  where o.chunk_id = retry_brain_vector_job.chunk_id
    and o.collection_generation = retry_brain_vector_job.generation
    and o.revision = retry_brain_vector_job.revision
    and o.status = 'running';
  return found;
end;
$$;

create or replace function public.dead_letter_brain_vector_job(
  chunk_id uuid,
  generation text,
  revision bigint,
  error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.brain_vector_outbox o
  set status = 'dead',
      lease_owner = null,
      lease_until = null,
      last_error = left(dead_letter_brain_vector_job.error, 2000),
      updated_at = now()
  where o.chunk_id = dead_letter_brain_vector_job.chunk_id
    and o.collection_generation = dead_letter_brain_vector_job.generation
    and o.revision = dead_letter_brain_vector_job.revision
    and o.status = 'running';
  return found;
end;
$$;

create or replace function public.list_brain_vector_chunks(
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
  embedding text
)
language sql
security definer
set search_path = pg_catalog, public
set statement_timeout = '15s'
as $$
  select k.id, k.org_id, g.generation, k.source_id, k.document_id, k.kind, k.occurred_at,
         k.content_hash, k.embedding_model, k.embedding::text
  from public.knowledge_chunks k
  join public.brain_vector_generations g
    on g.generation = list_brain_vector_chunks.generation
   and g.embedding_model = k.embedding_model
  where k.embedding is not null
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
  select k.id, k.org_id, k.content_hash, k.embedding_model
  from public.knowledge_chunks k
  join public.brain_vector_generations g
    on g.generation = filter_existing_brain_vector_chunks.generation
   and g.embedding_model = k.embedding_model
  where cardinality(chunk_ids) >= 1
    and k.id = any(chunk_ids)
    and k.embedding is not null
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
     and g.embedding_model = k.embedding_model
     and g.enqueue_enabled
    where k.embedding is not null
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
     and g.embedding_model = k.embedding_model
     and g.enqueue_enabled
    where k.embedding is not null
      and (after_chunk_id is null or k.id > after_chunk_id)
    order by k.id
    limit least(greatest(row_limit, 1), 1000)
  ) page
  order by page.id desc
  limit 1;

  return query select changed, cursor_id;
end;
$$;

create or replace function public.load_brain_vector_reconcile_cursor(generation text)
returns table (
  after_chunk_id uuid,
  cycle_started_at timestamptz,
  last_completed_at timestamptz,
  scanned bigint,
  repaired bigint,
  orphaned bigint,
  failed bigint
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select s.after_chunk_id, s.cycle_started_at, s.last_completed_at,
         s.scanned, s.repaired, s.orphaned, s.failed
  from public.brain_vector_reconcile_state s
  where s.collection_generation = load_brain_vector_reconcile_cursor.generation;
$$;

create or replace function public.save_brain_vector_reconcile_cursor(
  generation text,
  next_chunk_id uuid,
  scanned_delta integer default 0,
  repaired_delta integer default 0,
  orphaned_delta integer default 0,
  failed_delta integer default 0,
  cycle_complete boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.brain_vector_reconcile_state s
  set after_chunk_id = case when cycle_complete then null else next_chunk_id end,
      cycle_started_at = case
        when cycle_complete then null
        else coalesce(s.cycle_started_at, now())
      end,
      last_completed_at = case when cycle_complete then now() else s.last_completed_at end,
      scanned = case when cycle_complete then 0 else s.scanned + greatest(scanned_delta, 0) end,
      repaired = case when cycle_complete then 0 else s.repaired + greatest(repaired_delta, 0) end,
      orphaned = case when cycle_complete then 0 else s.orphaned + greatest(orphaned_delta, 0) end,
      failed = case when cycle_complete then 0 else s.failed + greatest(failed_delta, 0) end,
      updated_at = now()
  where s.collection_generation = save_brain_vector_reconcile_cursor.generation;
  return found;
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
    select 1
    from public.brain_vector_generations g
    where g.generation = p_generation
  ) then
    raise exception 'unknown brain vector generation: %', p_generation
      using errcode = '22023';
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
      join public.brain_vector_generations g
        on g.generation = p_generation
       and g.embedding_model = k.embedding_model
      where k.embedding is not null
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

revoke all on function public.enqueue_brain_vector_chunk() from public, anon, authenticated, app_ledger;
revoke all on function public.claim_brain_vector_jobs(text, integer, integer) from public, anon, authenticated, app_ledger;
revoke all on function public.ack_brain_vector_job(uuid, text, bigint) from public, anon, authenticated, app_ledger;
revoke all on function public.retry_brain_vector_job(uuid, text, bigint, text, timestamptz) from public, anon, authenticated, app_ledger;
revoke all on function public.dead_letter_brain_vector_job(uuid, text, bigint, text) from public, anon, authenticated, app_ledger;
revoke all on function public.list_brain_vector_chunks(uuid, integer, text) from public, anon, authenticated, app_ledger;
revoke all on function public.filter_existing_brain_vector_chunks(uuid[], text) from public, anon, authenticated, app_ledger;
revoke all on function public.enqueue_brain_vector_backfill(text, uuid, integer) from public, anon, authenticated, app_ledger;
revoke all on function public.load_brain_vector_reconcile_cursor(text) from public, anon, authenticated, app_ledger;
revoke all on function public.save_brain_vector_reconcile_cursor(text, uuid, integer, integer, integer, integer, boolean) from public, anon, authenticated, app_ledger;
revoke all on function public.brain_vector_worker_status(text) from public, anon, authenticated, app_ledger;

grant execute on function public.claim_brain_vector_jobs(text, integer, integer) to brain_vector_worker;
grant execute on function public.ack_brain_vector_job(uuid, text, bigint) to brain_vector_worker;
grant execute on function public.retry_brain_vector_job(uuid, text, bigint, text, timestamptz) to brain_vector_worker;
grant execute on function public.dead_letter_brain_vector_job(uuid, text, bigint, text) to brain_vector_worker;
grant execute on function public.list_brain_vector_chunks(uuid, integer, text) to brain_vector_worker;
grant execute on function public.filter_existing_brain_vector_chunks(uuid[], text) to brain_vector_worker;
grant execute on function public.enqueue_brain_vector_backfill(text, uuid, integer) to brain_vector_worker;
grant execute on function public.load_brain_vector_reconcile_cursor(text) to brain_vector_worker;
grant execute on function public.save_brain_vector_reconcile_cursor(text, uuid, integer, integer, integer, integer, boolean) to brain_vector_worker;
grant execute on function public.brain_vector_worker_status(text) to brain_vector_worker;

comment on table public.brain_vector_outbox is
  'Latest desired Qdrant serving-index state. Empty is not proof of canonical/index parity.';
comment on table public.brain_vector_generations is
  'Vector generation control. enqueue_enabled defaults false so infrastructure migrations are inert.';
