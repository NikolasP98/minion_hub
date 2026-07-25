import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260725030000_qdrant_owned_embeddings.sql',
    import.meta.url,
  ),
  'utf8',
);
const reconciliation = readFileSync(
  new URL(
    '../../../supabase/migrations/20260725183500_qdrant_owned_receipts_reconcile.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Qdrant-owned embedding storage migration', () => {
  it('defaults existing generations to pgvector and requires an explicit Qdrant cutover', () => {
    expect(migration).toContain("default 'pgvector'");
    expect(migration).toContain("storage_mode in ('pgvector', 'qdrant')");
    expect(migration).not.toMatch(/update\s+public\.brain_vector_generations/iu);
  });

  it('records an ack receipt per chunk so the pending signal both catches and drains', () => {
    const ack = reconciliation
      .split('create or replace function')
      .find((fn) => fn.includes('public.ack_brain_vector_job'));
    expect(ack).toBeDefined();
    expect(ack).toContain('returning o.* into acked');
    expect(ack).toContain(
      "when acked.desired_operation = 'upsert' then acked.desired_content_hash",
    );
    expect(ack).toContain(
      "when acked.desired_operation = 'upsert' then acked.collection_generation",
    );
    expect(ack).toContain('set vector_indexed_hash = indexed_hash');
    expect(ack).toContain('vector_indexed_generation = indexed_generation');
    expect(ack).toContain('chunk.org_id = acked.org_id');
    expect(ack).toContain('chunk.vector_indexed_generation is distinct from indexed_generation');
  });

  it('calls a chunk pending until the ACTIVE generation confirms its current content', () => {
    const statusFns = reconciliation
      .split('create or replace function')
      .filter((fn) => /brain_vector_app_source_(state|pending_count)/u.test(fn));
    expect(statusFns).toHaveLength(2);
    for (const fn of statusFns) {
      expect(fn).toContain('left join public.brain_vector_outbox job');
      expect(fn).toContain('job.collection_generation = (select generation from active)');
      expect(fn).toContain('chunk.vector_indexed_hash is distinct from chunk.content_hash');
      expect(fn).toContain(
        'chunk.vector_indexed_generation is distinct from (select generation from active)',
      );
      expect(fn).not.toContain('last_completed_at');
    }
  });

  it('exposes only org-scoped application status RPCs to app_ledger', () => {
    expect(reconciliation).toContain('brain_vector_app_generation_mode()');
    expect(reconciliation).toContain('brain_vector_app_source_state(p_source_id uuid)');
    expect(reconciliation).toContain('brain_vector_app_source_pending_count(p_source_id uuid)');
    expect(reconciliation).toContain("chunk.org_id = current_setting('app.current_org_id', true)");
    expect(reconciliation).toContain(
      'grant execute on function public.brain_vector_app_source_state(uuid) to app_ledger',
    );
  });
});
