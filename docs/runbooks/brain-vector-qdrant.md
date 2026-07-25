# Brain vector serving-index rollout

Supabase is canonical for chunk text and outbox state; Qdrant is the serving
index. Each generation declares who owns the vectors themselves through
`brain_vector_generations.storage_mode` — `pgvector` (default) keeps them in
Supabase and Qdrant stays rebuildable from Postgres alone; `qdrant` keeps only
text and outbox metadata in Postgres, so the vectors are rebuilt by re-embedding
rather than by copying (see §4). The migration installs the generation with
`enqueue_enabled = false`. Do not enable enqueue until the vector API and worker
are healthy and the checks below pass.

## 1. Disposable migration proof

Run the real-Postgres behavior test before applying the migration:

```bash
bash scripts/test-brain-vector-migration.sh
```

The test uses a disposable Supabase Postgres container and proves:

- a write made as `app_ledger` through a FORCE-RLS table fires the
  `SECURITY DEFINER` outbox trigger;
- a non-empty `list_brain_vector_chunks` row contains the requested generation,
  canonical org, vector, and embedding model;
- `filter_existing_brain_vector_chunks` reports canonical org ownership and
  raises SQLSTATE `22023` above 1,000 IDs;
- a separate custom LOGIN inheriting only `brain_vector_worker` can claim and
  revision-match ACK a job;
- enqueue is false again at the end.

## 2. Production worker role

Run as the database owner with a password supplied through the secret manager;
never put the password in source or shell history:

```sql
create role brain_vector_worker_login
  login inherit nobypassrls password :'worker_password';
grant brain_vector_worker to brain_vector_worker_login;
```

Connect as that LOGIN—not as `postgres` or the Supabase service role—and verify
its effective authority:

```sql
select
  current_user,
  pg_has_role(current_user, 'brain_vector_worker', 'USAGE') as inherits_worker,
  has_function_privilege(
    current_user,
    'public.claim_brain_vector_jobs(text,integer,integer)',
    'EXECUTE'
  ) as can_claim,
  has_function_privilege(
    current_user,
    'public.ack_brain_vector_job(uuid,text,bigint)',
    'EXECUTE'
  ) as can_ack,
  has_table_privilege(current_user, 'public.brain_vector_outbox', 'SELECT') as direct_outbox_select;
```

Expected: `inherits_worker`, `can_claim`, and `can_ack` are true;
`direct_outbox_select` is false.

## 3. FORCE-RLS trigger canary and actual LOGIN claim/ACK

Choose one existing embedded chunk only to supply valid foreign-key parents:

```sql
select org_id, source_id, document_id
from public.knowledge_chunks
where embedding is not null
  and embedding_model = 'text-embedding-3-small'
limit 1;
```

Keep the chosen values in psql variables `org_id`, `source_id`, and
`document_id`. The owner must first prove there is no existing backlog; do not
use the manual claim/ACK canary against a non-empty queue:

```sql
select status, count(*)
from public.brain_vector_outbox
group by status;

-- The restricted worker exposes the same operator-safe counters without any
-- direct table grant.
select * from public.brain_vector_worker_status('openai_te3s_1536_g1');
```

Proceed only when this returns no rows. As database owner, temporarily enable
only the active generation:

```sql
update public.brain_vector_generations
set enqueue_enabled = true
where generation = 'openai_te3s_1536_g1'
  and is_active;
```

As `app_ledger`, set the org GUC and insert a synthetic chunk. This is the FORCE
RLS canary: the insert must satisfy the canonical policy while its trigger must
still be able to enqueue into the worker-only table.

```sql
begin;
select set_config('app.current_org_id', :'org_id', true);
insert into public.knowledge_chunks (
  id, org_id, source_id, document_id, chunk_key, kind, seq,
  chunk_text, content_hash, embedding, embedding_model, metadata
) values (
  :'canary_chunk_id'::uuid, :'org_id', :'source_id'::uuid, :'document_id'::uuid,
  'brain-vector-preflight-' || :'canary_chunk_id', 'raw', 2147483647,
  'brain vector serving-index preflight canary',
  'sha256:brain-vector-preflight-' || :'canary_chunk_id',
  array_fill(0::real, array[1536])::vector,
  'text-embedding-3-small',
  '{"preflight":true}'::jsonb
);
commit;
```

Connect through the real `brain_vector_worker_login` credentials and perform an
actual claim and exact-revision ACK:

```sql
select *
from public.claim_brain_vector_jobs('production-preflight', 1, 60)
where chunk_id = :'canary_chunk_id'::uuid;

select public.ack_brain_vector_job(
  :'canary_chunk_id'::uuid,
  'openai_te3s_1536_g1',
  :'claimed_revision'::bigint
);
```

The ACK result must be true. Delete the synthetic chunk as `app_ledger`, then
claim and ACK the resulting delete job through the same worker LOGIN. Finally,
as owner, disable enqueue again:

```sql
update public.brain_vector_generations set enqueue_enabled = false;

select generation, enqueue_enabled
from public.brain_vector_generations
order by generation;
```

Every row must report `enqueue_enabled = false`. Only the controlled deployment
step may enable the active generation after the real worker has passed health,
Qdrant collection/alias checks, and this canary.

## 4. Qdrant-owned vectors (`storage_mode = 'qdrant'`)

In this mode Hub stops calling the embeddings provider for conversation-corpus
chunks: it writes the canonical text and the worker produces the vectors.
`knowledge_chunks.embedding` therefore stays null by design — "is the chunk
served?" is answered by the ack receipt (`vector_indexed_hash` +
`vector_indexed_generation`), not by the embedding column and not by an empty
outbox. A receipt earned under a retired generation does not count, so a
collection rotation reads as pending until its backfill reaches each chunk.

Prerequisite: the outbox trigger installed by
`20260723010000_brain_vector_outbox.sql` deliberately refuses to enqueue a
null-embedding chunk (an incomplete pgvector chunk has no valid serving-index
state). The worker deployment ships the trigger/RPC upgrade that makes a
null embedding the _expected_ state for a Qdrant-owned generation. Do not flip
`storage_mode` before that upgrade is applied, or newly written chunks will
never reach Qdrant and every source will sit at `queued`.

Two switches must then agree, and Hub enforces it: conversation-corpus writes
abort with `BRAIN_VECTOR_STORAGE_MODE=qdrant requires one active Qdrant-owned
vector generation` unless `public.brain_vector_app_generation_mode()` returns
`qdrant`. Cut over database-first, revert app-first:

1. As owner, set the active generation's mode and enable enqueue:

   ```sql
   update public.brain_vector_generations
   set storage_mode = 'qdrant', enqueue_enabled = true
   where generation = 'openai_te3s_1536_g1' and is_active;

   select public.brain_vector_app_generation_mode();  -- must return 'qdrant'
   ```

2. Only then deploy Hub with `BRAIN_VECTOR_STORAGE_MODE=qdrant`.

The business corpus (`brain-business-corpus.service.ts`) does not read this
flag: it keeps embedding into Supabase regardless, so the pgvector lane stays
live for those sources.

To roll back, remove the env var (or set it to `pgvector`) and redeploy first,
then move the generation back to `storage_mode = 'pgvector'` — the reverse order
leaves the app failing every conversation-corpus write in between. Rolling back
does not restore vectors: chunks written while Qdrant owned them have no
Postgres embedding, so the pgvector lane must re-embed them.

Brain source health in this mode comes from
`public.brain_vector_app_source_state(source_id)` and
`public.brain_vector_app_source_pending_count(source_id)` (both SECURITY
DEFINER, `app_ledger`-only, org-scoped by the `app.current_org_id` GUC) rather
than from counting null embeddings. A source that reports `queued` with a
non-zero pending count is waiting on the worker, not on Hub.
