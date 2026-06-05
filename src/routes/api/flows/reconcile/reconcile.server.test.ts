import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// Flows/groups read+write through getFlowsCtx (Postgres). user_preferences
// bookkeeping reads through getTenantCtx (Turso). Mock both — point them at the
// same mock db so the resolveSequence drives the flow/group selects.
const mockGetFlowsCtx = vi.fn<(l: unknown) => Promise<unknown>>();
vi.mock('$server/auth/flows-ctx', () => ({ getFlowsCtx: (l: unknown) => mockGetFlowsCtx(l) }));

const mockGetTenantCtx = vi.fn<(l: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx: (l: unknown) => mockGetTenantCtx(l) }));

const mockGetPrefs = vi.fn<(db: unknown, u: string) => Promise<Record<string, unknown>>>();
const mockUpsertPref = vi.fn<(db: unknown, u: string, s: string, v: unknown) => Promise<void>>();
vi.mock('$server/services/user-preferences.service', () => ({
  getUserPreferences: (db: unknown, u: string) => mockGetPrefs(db, u),
  upsertUserPreference: (db: unknown, u: string, s: string, v: unknown) => mockUpsertPref(db, u, s, v),
}));

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', supabaseId: 'supa-1', email: 't@t.com', displayName: 'T', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'], orgId: 'org-1', tenantCtx: undefined } as App.Locals;
}
beforeEach(() => vi.clearAllMocks());

function body(plugins: unknown) {
  return new Request('http://x/api/flows/reconcile', { method: 'POST', body: JSON.stringify({ plugins }) });
}

describe('POST /api/flows/reconcile', () => {
  it('creates a group + seeds instances for a freshly enabled plugin', async () => {
    const { db, resolveSequence } = createMockDb();
    // 1st select → existing groups (none); 2nd select → ungrouped flows (none)
    resolveSequence([[], []]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    mockGetPrefs.mockResolvedValue({});
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: body([{ pluginId: 'aw', displayName: 'Alert Watcher', enabled: true,
        templates: [{ id: 'pipeline', name: 'P', nodes: [{ id: 'n' }], edges: [] }] }]),
    } as Parameters<typeof POST>[0]);
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalled(); // group + seeded flow inserted
    expect(mockUpsertPref).toHaveBeenCalled(); // installed key recorded
    expect(out.groupsCreated).toBe(1);
    expect(out.flowsSeeded).toBe(1);
  });

  it('is a no-op (no inserts) when already reconciled', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'g1', name: 'Alert Watcher', userId: 'user-1', tenantId: 'org-1', pluginId: 'aw', disabled: false, createdAt: 0 }],
      [],
    ]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    mockGetPrefs.mockResolvedValue({ pluginFlowInstalls: { keys: ['aw:pipeline'] } });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: body([{ pluginId: 'aw', displayName: 'Alert Watcher', enabled: true,
        templates: [{ id: 'pipeline', name: 'P', nodes: [], edges: [] }] }]),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    expect(db.insert).not.toHaveBeenCalled();
    expect(mockUpsertPref).not.toHaveBeenCalled();
  });
});
