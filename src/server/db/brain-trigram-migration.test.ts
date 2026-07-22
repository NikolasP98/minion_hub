import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260722220000_brain_chunk_trigram_search.sql',
    import.meta.url,
  ),
  'utf8',
).replace(/\s+/g, ' ');

describe('Brain trigram candidate migration', () => {
  it('installs pg_trgm and indexes the exact lower(chunk_text) query expression', () => {
    expect(migration).toMatch(/create extension if not exists pg_trgm/i);
    expect(migration).toMatch(/create index if not exists knowledge_chunks_chunk_text_trgm_gin/i);
    expect(migration).toMatch(/using gin \(lower\(chunk_text\) gin_trgm_ops\)/i);
  });
});
