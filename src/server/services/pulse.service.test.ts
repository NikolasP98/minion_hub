import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// Sibling pattern (finance.service.test.ts): withOrgCore is mocked as a passthrough
// that runs the callback against the ctx's own db.transaction — so the mock-db
// chain proxy (db.insert/.select/... + resolveSequence) exercises the real
// service logic without hitting a live Postgres instance.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (
    scope: { db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> } },
    fn: (tx: unknown) => Promise<unknown>,
  ) => scope.db.transaction((tx) => fn(tx)),
}));

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-A' });

describe('pulse.service upsert', () => {
  it('is idempotent on (org_id, dedup_key)', async () => {
    const { upsertProposals, listPending } = await import('./pulse.service');
    const { db, resolveSequence } = createMockDb();
    const card = {
      source: 'daily_briefing',
      kind: 'digest',
      title: 'Your day',
      dedupKey: '2026-07-18:digest',
    };

    resolveSequence([
      [{ id: 'p1' }], // 1st upsertProposals: insert succeeds, 1 row returned by RETURNING
      [], // 2nd upsertProposals: onConflictDoNothing — same dedupKey, 0 rows returned
      [
        {
          id: 'p1',
          orgId: 'org-A',
          createdAt: new Date('2026-07-18T08:00:00Z'),
          source: 'daily_briefing',
          kind: 'digest',
          title: 'Your day',
          summary: null,
          payload: {},
          status: 'pending',
          dedupKey: '2026-07-18:digest',
          decidedBy: null,
          executedAt: null,
          error: null,
        },
      ], // listPending — still just the one row
    ]);

    const a = await upsertProposals(ctx(db), [card]);
    const b = await upsertProposals(ctx(db), [card]);

    expect(a.inserted).toBe(1);
    expect(b.inserted).toBe(0);
    expect(b.skipped).toBe(1);
    expect((await listPending(ctx(db))).length).toBe(1);
  });
});
