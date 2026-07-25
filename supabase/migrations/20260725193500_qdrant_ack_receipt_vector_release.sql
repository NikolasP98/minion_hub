-- Keep the Qdrant serving-index receipt and Supabase vector release in one
-- revision-safe ACK. The Hub receipt repair and the serving worker migration
-- previously replaced this function with complementary, incomplete bodies.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = public, pg_catalog;

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

  update public.knowledge_chunks chunk
  set embedding = null,
      embedding_model = null,
      updated_at = now()
  from public.brain_vector_generations active
  where active.generation = ack_brain_vector_job.generation
    and active.storage_mode = 'qdrant'
    and chunk.id = ack_brain_vector_job.chunk_id
    and chunk.org_id = acked.org_id
    and (chunk.embedding is not null or chunk.embedding_model is not null);

  return true;
end;
$$;

revoke all on function public.ack_brain_vector_job(uuid, text, bigint)
  from public, anon, authenticated, app_ledger;
grant execute on function public.ack_brain_vector_job(uuid, text, bigint)
  to brain_vector_worker;
