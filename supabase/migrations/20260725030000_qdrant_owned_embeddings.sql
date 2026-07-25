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
  select case
    when count(*) filter (where job.status = 'dead') > 0 then 'failed'
    when count(*) filter (where job.status in ('queued', 'running')) > 0 then 'queued'
    else 'ready'
  end
  from public.knowledge_chunks chunk
  join public.brain_vector_outbox job on job.chunk_id = chunk.id
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
  select count(*)
  from public.knowledge_chunks chunk
  join public.brain_vector_outbox job on job.chunk_id = chunk.id
  where chunk.org_id = current_setting('app.current_org_id', true)
    and chunk.source_id = p_source_id
    and job.status in ('queued', 'running', 'dead');
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
