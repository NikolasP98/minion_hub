import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Spec 039 S3: the dashboard's revenue overlay (CRM x finance join) needs BOTH datasets' view. */
const h = vi.hoisted(() => ({
  denied: new Set<string>(),
  revenueByResource: vi.fn(() => Promise.resolve([{ resourceId: 'r1' }])),
  schedulingSummary: vi.fn(() => Promise.resolve({ upcoming: 1 })),
}));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: (_l: unknown, module: string) =>
    Promise.resolve(
      h.denied.has(module) ? { denied: module, verb: 'view' } : { tenantId: 'org-1', module },
    ),
  isDenied: (v: unknown) => !!v && typeof v === 'object' && 'denied' in v,
}));
vi.mock('$server/services/scheduling-analytics.service', () => ({
  schedulingSummary: h.schedulingSummary,
  utilizationHeatmap: () => Promise.resolve([]),
  revenueByResource: h.revenueByResource,
}));

async function call() {
  const { load } = await import('./+page.server');
  return (await load({ locals: {}, depends: () => {} } as unknown as Parameters<
    typeof load
  >[0])) as {
    scheduling: Record<string, unknown>;
  };
}

beforeEach(() => {
  h.denied.clear();
  vi.clearAllMocks();
});

describe('/scheduling +page.server load', () => {
  it('scheduling denied: the whole slot is the marker and no analytics run', async () => {
    h.denied.add('scheduling');
    const out = await call();
    expect(out.scheduling).toEqual({ denied: 'scheduling', verb: 'view' });
    expect(h.schedulingSummary).not.toHaveBeenCalled();
  });

  it('finance denied: summary still loads, revenue overlay is skipped', async () => {
    h.denied.add('finance');
    const out = await call();
    expect(out.scheduling.revenue).toEqual([]);
    expect(h.revenueByResource).not.toHaveBeenCalled();
  });

  it('all allowed: previous behaviour', async () => {
    const out = await call();
    expect(out.scheduling.revenue).toEqual([{ resourceId: 'r1' }]);
  });
});
