import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260725030000_qdrant_owned_embeddings.sql',
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

  it('exposes only org-scoped application status RPCs to app_ledger', () => {
    expect(migration).toContain('brain_vector_app_generation_mode()');
    expect(migration).toContain('brain_vector_app_source_state(p_source_id uuid)');
    expect(migration).toContain('brain_vector_app_source_pending_count(p_source_id uuid)');
    expect(migration).toContain("chunk.org_id = current_setting('app.current_org_id', true)");
    expect(migration).toContain(
      'grant execute on function public.brain_vector_app_source_state(uuid) to app_ledger',
    );
  });
});
