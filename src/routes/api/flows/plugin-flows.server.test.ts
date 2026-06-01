import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetFlowsCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/flows-ctx', () => ({
  getFlowsCtx: (locals: unknown) => mockGetFlowsCtx(locals),
}));

function makeLocals(): App.Locals {
  return {
    user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'],
    orgId: 'org-1',
    tenantCtx: undefined,
  } as App.Locals;
}

const PLUGIN_CONFIG = JSON.stringify({ source: { pluginId: 'alert-watcher', templateId: 'pipeline' } });

beforeEach(() => vi.clearAllMocks());

describe('GET /api/flows — plugin origin', () => {
  it('surfaces pluginId for plugin-imported flows and null for user flows', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'f1', name: 'Alert Watcher pipeline', nodes: '[]', active: false, createdAt: 1, updatedAt: 2, config: PLUGIN_CONFIG },
      { id: 'f2', name: 'My flow', nodes: '[]', active: false, createdAt: 1, updatedAt: 1, config: '{}' },
    ]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });

    const { GET } = await import('./+server');
    const res = await GET({
      locals: makeLocals(),
      url: new URL('http://localhost/api/flows'),
    } as Parameters<typeof GET>[0]);

    const body = await res.json();
    const byId = Object.fromEntries(body.flows.map((f: { id: string }) => [f.id, f]));
    expect(byId.f1.pluginId).toBe('alert-watcher');
    expect(byId.f2.pluginId).toBeNull();
  });
});

describe('DELETE /api/flows/[id] — instances are deletable', () => {
  it('allows deleting a plugin-imported instance (no longer 403)', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', userId: 'user-1', tenantId: 'org-1', config: PLUGIN_CONFIG }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    const res = await DELETE({ locals: makeLocals(), params: { id: 'f1' } } as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('allows deleting a user-authored flow', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f2', userId: 'user-1', tenantId: 'org-1', config: '{}' }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    const res = await DELETE({ locals: makeLocals(), params: { id: 'f2' } } as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
