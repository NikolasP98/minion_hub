-- Record the canonical storage boundary used by the private brain-vector
-- worker. The worker deployment applies the corresponding least-privilege RPC
-- upgrades before this mode is changed from its backward-compatible default.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.brain_vector_generations
  add column if not exists storage_mode text not null default 'pgvector';

alter table public.brain_vector_generations
  drop constraint if exists brain_vector_generations_storage_mode_check;
alter table public.brain_vector_generations
  add constraint brain_vector_generations_storage_mode_check
  check (storage_mode in ('pgvector', 'qdrant'));

comment on column public.brain_vector_generations.storage_mode is
  'pgvector keeps canonical vectors in Postgres; qdrant keeps only canonical text and durable outbox metadata in Postgres.';

-- Serving-index receipt. A worker ack DELETES the outbox row, so a drained
-- outbox alone cannot tell "this chunk is in Qdrant" from "nothing ever
-- enqueued this chunk". The ack now records WHICH content it indexed, which is
-- the only signal that both catches never-indexed chunks and drains back to
-- zero once the worker has caught up. Not in the trigger's UPDATE OF column
-- list, so writing it never re-enqueues the chunk it acknowledges.
alter table public.knowledge_chunks
  add column if not exists vector_indexed_hash text;

comment on column public.knowledge_chunks.vector_indexed_hash is
  'content_hash the serving-index worker last confirmed for this chunk; null or stale means the chunk is not in the serving index at its current content.';

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

  update public.knowledge_chunks chunk
  set vector_indexed_hash = indexed_hash
  where chunk.id = ack_brain_vector_job.chunk_id
    and chunk.org_id = acked.org_id
    and chunk.vector_indexed_hash is distinct from indexed_hash;

  return true;
end;
$$;

create or replace function public.brain_vector_app_generation_mode()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select generation.storage_mode
  from public.brain_vector_generations generation
  where generation.is_active and generation.enqueue_enabled
  limit 1;
$$;

-- Pending means "this chunk's current content is not in the serving index":
-- either the outbox still owes work for it, or no ack has ever confirmed its
-- present content_hash. Both halves matter — outbox rows alone go silent once
-- drained, and the receipt alone lags a re-chunked document by one worker pass.
create or replace function public.brain_vector_app_source_state(p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with active as (
    select generation.generation
    from public.brain_vector_generations generation
    where generation.is_active and generation.enqueue_enabled
    limit 1
  )
  select case
    when count(*) filter (where job.status = 'dead') > 0 then 'failed'
    when count(*) filter (
      where job.status in ('queued', 'running')
        or chunk.vector_indexed_hash is distinct from chunk.content_hash
    ) > 0 then 'queued'
    else 'ready'
  end
  from public.knowledge_chunks chunk
  left join public.brain_vector_outbox job
    on job.chunk_id = chunk.id
    and job.collection_generation = (select generation from active)
  where chunk.org_id = current_setting('app.current_org_id', true)
    and chunk.source_id = p_source_id;
$$;

create or replace function public.brain_vector_app_source_pending_count(p_source_id uuid)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with active as (
    select generation.generation
    from public.brain_vector_generations generation
    where generation.is_active and generation.enqueue_enabled
    limit 1
  )
  select count(*)
  from public.knowledge_chunks chunk
  left join public.brain_vector_outbox job
    on job.chunk_id = chunk.id
    and job.collection_generation = (select generation from active)
  where chunk.org_id = current_setting('app.current_org_id', true)
    and chunk.source_id = p_source_id
    and (
      job.status in ('queued', 'running', 'dead')
      or chunk.vector_indexed_hash is distinct from chunk.content_hash
    );
$$;

revoke all on function public.brain_vector_app_generation_mode()
  from public, anon, authenticated;
revoke all on function public.brain_vector_app_source_state(uuid)
  from public, anon, authenticated;
revoke all on function public.brain_vector_app_source_pending_count(uuid)
  from public, anon, authenticated;
grant execute on function public.brain_vector_app_generation_mode() to app_ledger;
grant execute on function public.brain_vector_app_source_state(uuid) to app_ledger;
grant execute on function public.brain_vector_app_source_pending_count(uuid) to app_ledger;
