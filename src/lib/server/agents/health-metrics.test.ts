import { describe, it, expect, vi } from 'vitest';

const tx = { select: vi.fn() };
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_s: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
}));

import { getHealthMetrics } from './health-metrics';

function vm(over: Record<string, unknown> = {}) {
  return { id: 'a', name: 'A', status: { enabled: true, state: 'active' }, ...over } as never;
}
const ctx = { tenantId: 'org1' } as never;

describe('getHealthMetrics', () => {
  it('DB-flow agent: derives from flow_runs', async () => {
    tx.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ total: 4, ok: 3, last: 1000 }]) }),
    });
    const m = await getHealthMetrics(ctx, vm({ dbFlowId: 'f1' }), 5000);
    expect(m).toEqual({ state: 'active', lastRunAt: 1000, runs30d: 4, successRate: 0.75 });
  });

  it('stats fallback: derives from status.stats', async () => {
    const m = await getHealthMetrics(
      ctx,
      vm({ status: { enabled: true, state: 'active', stats: { sent: 8, failed: 2, skipped: 5 } } }),
    );
    expect(m).toEqual({ state: 'active', lastRunAt: null, runs30d: 15, successRate: 0.8 });
  });

  it('status.health (e.g. triage): used directly, wins over stats', async () => {
    const m = await getHealthMetrics(
      ctx,
      vm({ status: { enabled: true, state: 'active', health: { lastRunAt: null, runs30d: 37, successRate: 0.95 } } }),
    );
    expect(m).toEqual({ state: 'active', lastRunAt: null, runs30d: 37, successRate: 0.95 });
  });

  it('no data: all null', async () => {
    const m = await getHealthMetrics(ctx, vm({ status: { enabled: false, state: 'disabled' } }));
    expect(m).toEqual({ state: 'disabled', lastRunAt: null, runs30d: null, successRate: null });
  });
});
