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
});
