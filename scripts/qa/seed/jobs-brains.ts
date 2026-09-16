/**
 * Jobs / brains — the generic bg_jobs queue (terminal states only — a
 * 'running' row would be reclaimed by the next cron tick), one succeeded
 * fin_sync_jobs row, and the AI-Brains knowledge pipeline (master + focused
 * brain, a failed document, a degraded source, a null-embedding chunk).
 */
import { matrixTextId, matrixUuid } from './ids';
import { ORG_BUSINESS, userId } from './tenancy';
import type { SeedContext } from './db';

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;
  const owner = userId('tenancy.user.owner');
  const ms = now.getTime();

  const bgJobs: Array<{ matrixId: string; status: string }> = [
    { matrixId: 'jobs.bg.done', status: 'done' },
    { matrixId: 'jobs.bg.failed', status: 'failed' },
    { matrixId: 'jobs.bg.cancelled', status: 'cancelled' },
  ];
  for (const job of bgJobs) {
    const id = matrixTextId(job.matrixId);
    await sql`
      insert into bg_jobs (id, tenant_id, type, ref_id, status, error, attempts, created_at, updated_at, started_at, finished_at)
      values (
        ${id}, ${ORG_BUSINESS}, 'qa-seed-demo', ${id}, ${job.status},
        ${job.status === 'failed' ? 'QA: simulated handler failure' : null},
        ${job.status === 'failed' ? 3 : 1}, ${ms}, ${ms}, ${ms}, ${ms}
      )
      on conflict (id) do update set status = excluded.status
    `;
    register(job.matrixId, { table: 'bg_jobs', where: { id } });
  }

  const finSyncSucceededId = matrixUuid('jobs.fin-sync.succeeded');
  await sql`
    insert into fin_sync_jobs (id, org_id, provider, status, total, processed, started_at, finished_at, heartbeat_at)
    values (${finSyncSucceededId}, ${ORG_BUSINESS}, 'susii', 'succeeded', 300, 300, ${now.toISOString()}, ${now.toISOString()}, ${now.toISOString()})
    on conflict (id) do update set status = excluded.status
  `;
  register('jobs.fin-sync.succeeded', {
    table: 'fin_sync_jobs',
    where: { id: finSyncSucceededId },
  });

  const brainMaster = matrixUuid('brains.master');
  const brainFocused = matrixUuid('brains.focused');
  await sql`
    insert into brains (id, org_id, name, description, visibility, kind, include_all_sources, created_by)
    values
      (${brainMaster}, ${ORG_BUSINESS}, 'QA Master Brain', 'All-source master brain', 'org', 'master', true, ${owner}),
      (${brainFocused}, ${ORG_BUSINESS}, 'QA Focused Brain', 'Single-source focused brain', 'org', 'focused', false, ${owner})
    on conflict (id) do update set name = excluded.name
  `;
  register('brains.master', { table: 'brains', where: { id: brainMaster } });
  register('brains.focused', { table: 'brains', where: { id: brainFocused } });

  const docFailedId = matrixUuid('brains.document.failed');
  await sql`
    insert into brain_documents (id, brain_id, org_id, title, source_type, status, error, created_by)
    values (${docFailedId}, ${brainFocused}, ${ORG_BUSINESS}, 'QA Failed Document', 'note', 'failed', 'QA: simulated ingest failure', ${owner})
    on conflict (id) do update set status = excluded.status
  `;
  register('brains.document.failed', { table: 'brain_documents', where: { id: docFailedId } });

  const sourceDegradedId = matrixUuid('brains.source.degraded');
  await sql`
    insert into knowledge_sources (id, org_id, connector, external_key, name, status)
    values (${sourceDegradedId}, ${ORG_BUSINESS}, 'qa-connector', 'qa-degraded-source', 'QA Degraded Source', 'degraded')
    on conflict (org_id, connector, external_key) do update set status = excluded.status
  `;
  register('brains.source.degraded', {
    table: 'knowledge_sources',
    where: { id: sourceDegradedId },
  });

  const docId = matrixUuid('brains.chunk.null-embedding', 'document');
  await sql`
    insert into knowledge_documents (id, org_id, source_id, external_id, title, raw_text, normalized_text, content_hash, status)
    values (${docId}, ${ORG_BUSINESS}, ${sourceDegradedId}, 'qa-doc-1', 'QA Document', 'raw', 'normalized', ${matrixUuid('brains.chunk.null-embedding', 'hash')}, 'ready')
    on conflict (org_id, source_id, external_id) do nothing
  `;
  const chunkNullEmbeddingId = matrixUuid('brains.chunk.null-embedding');
  await sql`
    insert into knowledge_chunks (id, org_id, source_id, document_id, chunk_key, seq, chunk_text, content_hash, embedding)
    values (${chunkNullEmbeddingId}, ${ORG_BUSINESS}, ${sourceDegradedId}, ${docId}, 'qa-chunk-1', 0, 'QA chunk text awaiting embedding', ${matrixUuid('brains.chunk.null-embedding', 'chunk-hash')}, null)
    on conflict (org_id, document_id, chunk_key) do nothing
  `;
  register('brains.chunk.null-embedding', {
    table: 'knowledge_chunks',
    where: { id: chunkNullEmbeddingId },
  });
}
