import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guardFilename = '20260722233000_brain_ann_storage_guard.sql';
const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url);
const migration = readFileSync(
  new URL(guardFilename, migrationsUrl),
  'utf8',
).toLowerCase();

describe('Brain ANN storage guard migration', () => {
  it('removes only the optional vector acceleration indexes', () => {
    expect(migration).toContain('drop index if exists public.knowledge_chunks_embedding_hnsw');
    expect(migration).toContain(
      'drop index if exists public.crm_conversation_chunks_embedding_ivfflat',
    );
    expect(migration).toContain('drop index if exists public.messages_message_id_idx');
    expect(migration).toContain('drop index if exists public.agent_memories_embedding_hnsw');
    expect(migration).toContain("set local lock_timeout = '5s'");
    expect(migration.match(/drop index/g)).toHaveLength(4);
    expect(migration).not.toContain('messages_org_client_id_uniq');
    expect(migration).not.toContain('messages_org_channel_account_msg_uniq');
    expect(migration).not.toMatch(/drop\s+(table|column)/);
    expect(migration).not.toMatch(/\b(create\s+index|alter\s+table|insert\s+into|update\s+|delete\s+from|truncate\s+)/);
  });

  it('documents exact retrieval as the supported fallback', () => {
    expect(migration).toContain('exact cosine');
    expect(migration).toContain('embeddings remain canonical');
  });

  it('sorts after both creators and prevents later migrations from recreating the indexes', () => {
    const files = readdirSync(migrationsUrl)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    const guardIndex = files.indexOf(guardFilename);

    expect(guardIndex).toBeGreaterThan(files.indexOf('20260717230000_crm_conversation_chunks.sql'));
    expect(guardIndex).toBeGreaterThan(files.indexOf('20260721210000_unified_brain_corpus.sql'));

    for (const file of files.slice(guardIndex + 1)) {
      const laterMigration = readFileSync(new URL(file, migrationsUrl), 'utf8').toLowerCase();
      expect(laterMigration, file).not.toContain('knowledge_chunks_embedding_hnsw');
      expect(laterMigration, file).not.toContain('crm_conversation_chunks_embedding_ivfflat');
    }
  });
});
