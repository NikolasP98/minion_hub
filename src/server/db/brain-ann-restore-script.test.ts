import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync(
  new URL('../../../scripts/restore-brain-ann.ts', import.meta.url),
  'utf8',
).toLowerCase();

describe('Brain ANN restoration operator script', () => {
  it('is dry-run by default and requires measured free headroom to apply', () => {
    expect(script).toContain("const apply_flag = '--apply'");
    expect(script).toContain("const headroom_prefix = '--free-headroom-gib='");
    expect(script).toContain('const minimum_free_headroom_gib = 1.5');
    expect(script).toContain('const estimated_hnsw_bytes_per_chunk = 9 * 1024');
    expect(script).toContain('const peak_headroom_multiplier = 2.5');
    expect(script).toContain('assertedfreeheadroomgib < requiredfreeheadroomgib');
  });

  it('restores only the canonical corpus accelerator without a blocking build', () => {
    expect(script).toContain('create index concurrently if not exists');
    expect(script).toContain('knowledge_chunks_embedding_hnsw');
    expect(script).toContain('on public.knowledge_chunks using hnsw (embedding vector_cosine_ops)');
    expect(script).not.toContain('crm_conversation_chunks_embedding_ivfflat');
    expect(script).not.toContain('messages_message_id_idx');
    expect(script).not.toContain('agent_memories_embedding_hnsw');
  });

  it('fails closed around database health, long transactions, and index validity', () => {
    expect(script).toContain("health.readonly !== 'off'");
    expect(script).toContain('pg_is_in_recovery()');
    expect(script).toContain('longtransactions.length > 0');
    expect(script).toContain('!before.valid || !before.ready || !before.live');
    expect(script).toContain('!after?.valid || !after.ready || !after.live');
    expect(script).toContain("set lock_timeout = '5s'");
    expect(script).toContain('set default_transaction_read_only = off');
    expect(script).toContain('drop index concurrently if exists public.${index_name}');
    expect(script).toContain('if (apply && buildstarted && failed');
  });
});
