import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260713230000_built_agents_runtime_agent.sql',
    import.meta.url,
  ),
  'utf8',
).replace(/\s+/g, ' ');

describe('builder runtime-agent migration', () => {
  test('is additive, idempotent, nullable, and indexes only deployed drafts', () => {
    expect(migration).toMatch(/add column if not exists runtime_agent_id text/i);
    expect(migration).not.toMatch(/runtime_agent_id text not null/i);
    expect(migration).toMatch(/create index if not exists idx_built_agents_runtime_agent/i);
    expect(migration).toMatch(/where runtime_agent_id is not null/i);
    expect(migration).not.toMatch(/references\s*\(/i);
  });
});
