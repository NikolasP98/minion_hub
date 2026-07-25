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
