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

beforeEach(() => vi.clearAllMocks());

describe('GET /api/flow-groups', () => {
  it('returns groups with pluginId + disabled', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'g1', name: 'My', userId: 'user-1', tenantId: 'org-1', pluginId: null, disabled: false, createdAt: 1, updatedAt: 1 },
      { id: 'g2', name: 'AW', userId: 'user-1', tenantId: 'org-1', pluginId: 'alert-watcher', disabled: true, createdAt: 2, updatedAt: 2 },
    ]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { GET } = await import('./+server');
    const res = await GET({ locals: makeLocals() } as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.groups).toHaveLength(2);
    expect(body.groups[1]).toMatchObject({ id: 'g2', pluginId: 'alert-watcher', disabled: true });
  });
});

describe('POST /api/flow-groups', () => {
  it('creates a user group (pluginId null)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: new Request('http://x/api/flow-groups', { method: 'POST', body: JSON.stringify({ name: 'Marketing' }) }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank name with 400', async () => {
    const { db } = createMockDb();
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    let status = 0;
    try {
      await POST({
        locals: makeLocals(),
        request: new Request('http://x/api/flow-groups', { method: 'POST', body: JSON.stringify({ name: '' }) }),
      } as Parameters<typeof POST>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(400);
  });
});

describe('DELETE /api/flow-groups/[id]', () => {
  it('rejects deleting a plugin group with 403', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g2', userId: 'user-1', tenantId: 'org-1', pluginId: 'alert-watcher', disabled: false }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    let status = 0;
    try {
      await DELETE({ locals: makeLocals(), params: { id: 'g2' } } as Parameters<typeof DELETE>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(403);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes a user group and reassigns its flows to ungrouped', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g1', userId: 'user-1', tenantId: 'org-1', pluginId: null, disabled: false }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    const res = await DELETE({ locals: makeLocals(), params: { id: 'g1' } } as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalled(); // flows.group_id → null
    expect(db.delete).toHaveBeenCalledTimes(1); // group removed
  });
});

describe('PATCH /api/flow-groups/[id]', () => {
  it('renames a user group', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g1', userId: 'user-1', tenantId: 'org-1', pluginId: null, disabled: false }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { PATCH } = await import('./[id]/+server');
    const res = await PATCH({
      locals: makeLocals(), params: { id: 'g1' },
      request: new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) }),
    } as Parameters<typeof PATCH>[0]);
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalled();
  });

  it('rejects renaming a plugin group with 403', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g2', userId: 'user-1', tenantId: 'org-1', pluginId: 'alert-watcher', disabled: false }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { PATCH } = await import('./[id]/+server');
    let status = 0;
    try {
      await PATCH({
        locals: makeLocals(), params: { id: 'g2' },
        request: new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Nope' }) }),
      } as Parameters<typeof PATCH>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(403);
  });
});
