-- Reconcile the production schema after the already-recorded
-- 20260725030000 migration was expanded with serving-index receipts. Migration
-- versions are immutable once recorded, so the final receipt/RPC contract must
-- advance under a new version even though every statement is idempotent.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.knowledge_chunks
  add column if not exists vector_indexed_hash text;
alter table public.knowledge_chunks
  add column if not exists vector_indexed_generation text;

comment on column public.knowledge_chunks.vector_indexed_hash is
  'content_hash the serving-index worker last confirmed for this chunk; null or stale means the chunk is not in the serving index at its current content.';
comment on column public.knowledge_chunks.vector_indexed_generation is
  'collection generation that confirmed vector_indexed_hash; a receipt from any other generation does not count as indexed.';

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

  update public.knowledge_chunks chunk
  set vector_indexed_hash = indexed_hash,
      vector_indexed_generation = indexed_generation
  where chunk.id = ack_brain_vector_job.chunk_id
    and chunk.org_id = acked.org_id
    and (
      chunk.vector_indexed_hash is distinct from indexed_hash
      or chunk.vector_indexed_generation is distinct from indexed_generation
    );

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
        or chunk.vector_indexed_generation is distinct from (select generation from active)
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
      or chunk.vector_indexed_generation is distinct from (select generation from active)
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
