import { describe, expect, it } from 'vitest';
import { evaluatePairing } from './check-migration-seed-pairing';

describe('evaluatePairing (spec §6 rule 1)', () => {
  it('no migrations touched — always OK, regardless of seed changes or labels', () => {
    const result = evaluatePairing({
      changed: ['src/routes/api/pos/+server.ts', 'CLAUDE.md'],
      labels: [],
    });
    expect(result.ok).toBe(true);
    expect(result.migrationFiles).toEqual([]);
  });

  it('migrations touched + seed touched — OK', () => {
    const result = evaluatePairing({
      changed: ['supabase/migrations/20260916000000_new_table.sql', 'scripts/qa/seed/matrix.ts'],
      labels: [],
    });
    expect(result.ok).toBe(true);
    expect(result.migrationFiles).toEqual(['supabase/migrations/20260916000000_new_table.sql']);
  });

  it('migrations touched + baseline touched (no seed/** change) — OK', () => {
    const result = evaluatePairing({
      changed: [
        'supabase/migrations/20260916000000_new_table.sql',
        'supabase/qa/baseline/schema.sql',
      ],
      labels: [],
    });
    expect(result.ok).toBe(true);
  });

  it('migrations touched + no seed/baseline change + no label — FAILS', () => {
    const result = evaluatePairing({
      changed: ['supabase/migrations/20260916000000_new_table.sql', 'src/lib/foo.ts'],
      labels: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/spec §6 rule 1/);
    expect(result.reason).toMatch(/20260916000000_new_table\.sql/);
  });

  it('migrations touched + no seed/baseline change + seed-unaffected label — OK', () => {
    const result = evaluatePairing({
      changed: ['supabase/migrations/20260916000000_new_table.sql'],
      labels: ['seed-unaffected'],
    });
    expect(result.ok).toBe(true);
  });

  it('does not treat a non-.sql file under supabase/migrations/ as a migration', () => {
    const result = evaluatePairing({
      changed: ['supabase/migrations/README.md'],
      labels: [],
    });
    expect(result.ok).toBe(true);
    expect(result.migrationFiles).toEqual([]);
  });

  it('an unrelated label does not satisfy the exemption', () => {
    const result = evaluatePairing({
      changed: ['supabase/migrations/20260916000000_new_table.sql'],
      labels: ['bug', 'good first issue'],
    });
    expect(result.ok).toBe(false);
  });
});
