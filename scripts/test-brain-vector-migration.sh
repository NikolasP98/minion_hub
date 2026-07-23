#!/usr/bin/env bash
set -euo pipefail

# Real-Postgres behavior check for the Qdrant outbox migration. This deliberately
# uses a disposable database because FORCE RLS, SECURITY DEFINER ownership, role
# inheritance, trigger behavior, and RPC return shapes cannot be proven by mocks.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MIGRATION="${REPO_DIR}/supabase/migrations/20260723010000_brain_vector_outbox.sql"
IMAGE="${BRAIN_VECTOR_TEST_POSTGRES_IMAGE:-pgvector/pgvector:pg15}"
CONTAINER="brain-vector-migration-$RANDOM-$RANDOM"
POSTGRES_PASSWORD="brain-vector-test-superuser"
WORKER_PASSWORD="brain-vector-test-worker"

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d \
  --name "${CONTAINER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  "${IMAGE}" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${CONTAINER}" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${CONTAINER}" pg_isready -U postgres -d postgres >/dev/null

docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create extension if not exists vector;
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'app_ledger') then
    create role app_ledger nologin noinherit nobypassrls;
  end if;
end
$$;
grant app_ledger to postgres;

create table public.knowledge_chunks (
  id uuid primary key,
  org_id text not null,
  source_id uuid not null,
  document_id uuid not null,
  kind text not null,
  occurred_at timestamptz,
  content_hash text not null,
  embedding_model text,
  embedding vector(1536)
);
alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_chunks force row level security;
create policy knowledge_chunks_org_guc on public.knowledge_chunks
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
grant select, insert, update, delete on public.knowledge_chunks to app_ledger;
SQL

docker exec -i "${CONTAINER}" psql -1 -v ON_ERROR_STOP=1 -U postgres -d postgres <"${MIGRATION}"

docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
update public.brain_vector_generations
set enqueue_enabled = true
where generation = 'openai_te3s_1536_g1';

begin;
set local role app_ledger;
select set_config('app.current_org_id', 'org-canary', true);
insert into public.knowledge_chunks (
  id, org_id, source_id, document_id, kind, occurred_at,
  content_hash, embedding_model, embedding
) values (
  '018f87f4-e934-7a21-98b6-4f6b8d3898dd',
  'org-canary',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'raw',
  '2026-07-22T20:00:00Z',
  'sha256:canary',
  'text-embedding-3-small',
  array_fill(0::real, array[1536])::vector
);
commit;

do $$
declare
  listed record;
  filtered record;
begin
  if not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.knowledge_chunks'::regclass) then
    raise exception 'knowledge_chunks FORCE RLS canary precondition is false';
  end if;
  if not exists (
    select 1 from public.brain_vector_outbox
    where chunk_id = '018f87f4-e934-7a21-98b6-4f6b8d3898dd'
      and org_id = 'org-canary'
      and desired_operation = 'upsert'
  ) then
    raise exception 'FORCE RLS app_ledger insert did not enqueue the trigger canary';
  end if;

  select * into listed
  from public.list_brain_vector_chunks(null, 10, 'openai_te3s_1536_g1')
  where chunk_id = '018f87f4-e934-7a21-98b6-4f6b8d3898dd';
  if listed is null
     or listed.org_id <> 'org-canary'
     or listed.generation <> 'openai_te3s_1536_g1'
     or listed.embedding_model <> 'text-embedding-3-small'
     or listed.embedding is null then
    raise exception 'non-empty reconcile RPC row shape is incomplete: %', listed;
  end if;

  select * into filtered
  from public.filter_existing_brain_vector_chunks(
    array['018f87f4-e934-7a21-98b6-4f6b8d3898dd'::uuid],
    'openai_te3s_1536_g1'
  );
  if filtered is null or filtered.org_id <> 'org-canary' then
    raise exception 'existing-chunk filter did not report canonical org: %', filtered;
  end if;

  begin
    perform *
    from public.filter_existing_brain_vector_chunks(
      array_fill('018f87f4-e934-7a21-98b6-4f6b8d3898dd'::uuid, array[1001]),
      'openai_te3s_1536_g1'
    );
    raise exception 'existing-chunk filter silently accepted more than 1000 IDs';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform * from public.brain_vector_worker_status('missing_generation');
    raise exception 'worker status silently accepted an unknown generation';
  exception when sqlstate '22023' then
    null;
  end;
end
$$;

create role brain_vector_worker_login
  login inherit nobypassrls password 'brain-vector-test-worker';
grant brain_vector_worker to brain_vector_worker_login;
SQL

claim="$(
  docker exec -e PGPASSWORD="${WORKER_PASSWORD}" "${CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U brain_vector_worker_login -d postgres \
      -At -F '|' -c \
      "select chunk_id, generation, revision from public.claim_brain_vector_jobs('preflight-login', 1, 60)"
)"
IFS='|' read -r claimed_chunk claimed_generation claimed_revision <<<"${claim}"
test "${claimed_chunk}" = "018f87f4-e934-7a21-98b6-4f6b8d3898dd"
test "${claimed_generation}" = "openai_te3s_1536_g1"
test -n "${claimed_revision}"

ack="$(
  docker exec -e PGPASSWORD="${WORKER_PASSWORD}" "${CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U brain_vector_worker_login -d postgres \
      -At -c \
      "select public.ack_brain_vector_job('${claimed_chunk}', '${claimed_generation}', ${claimed_revision})"
)"
test "${ack}" = "t"

status="$(
  docker exec -e PGPASSWORD="${WORKER_PASSWORD}" "${CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U brain_vector_worker_login -d postgres \
      -At -F '|' -c \
      "select queued, running, dead, canonical_chunks from public.brain_vector_worker_status('openai_te3s_1536_g1')"
)"
test "${status}" = "0|0|0|1"

docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
do $$
begin
  if exists (
    select 1 from public.brain_vector_outbox
    where chunk_id = '018f87f4-e934-7a21-98b6-4f6b8d3898dd'
  ) then
    raise exception 'custom worker LOGIN claim/ack did not clear the exact revision';
  end if;
end
$$;

update public.brain_vector_generations
set enqueue_enabled = false
where generation = 'openai_te3s_1536_g1';

do $$
begin
  if exists (select 1 from public.brain_vector_generations where enqueue_enabled) then
    raise exception 'migration behavior test left enqueue enabled';
  end if;
end
$$;
SQL

echo "brain-vector migration behavior: PASS"
