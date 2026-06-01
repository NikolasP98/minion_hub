import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetFlowsCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/flows-ctx', () => ({ getFlowsCtx: (l: unknown) => mockGetFlowsCtx(l) }));

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'], orgId: 'org-1', tenantCtx: undefined } as App.Locals;
}
beforeEach(() => vi.clearAllMocks());

describe('GET /api/flows — groupId', () => {
  it('returns groupId on each flow', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', name: 'F', nodes: '[]', active: false, createdAt: 1, updatedAt: 1, config: '{}', groupId: 'g1' }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { GET } = await import('./+server');
    const res = await GET({ locals: makeLocals(), url: new URL('http://x/api/flows') } as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.flows[0].groupId).toBe('g1');
  });
});

describe('POST /api/flows — groupId + templateId', () => {
  it('persists groupId and the template source (into a group the user owns)', async () => {
    const { db, resolve } = createMockDb();
    // group-ownership lookup returns a group owned by this user → passes the check
    resolve([{ id: 'g1', userId: 'user-1', tenantId: 'org-1', pluginId: 'aw' }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: new Request('http://x/api/flows', { method: 'POST', body: JSON.stringify({ name: 'New', groupId: 'g1', pluginId: 'aw', templateId: 'pipeline', nodes: [{ id: 'n' }], edges: [] }) }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('creates an ungrouped flow with no group lookup when groupId is absent', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: new Request('http://x/api/flows', { method: 'POST', body: JSON.stringify({ name: 'Solo' }) }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('SECURITY: rejects a groupId belonging to another org (IDOR) with 403 and no insert', async () => {
    const { db, resolve } = createMockDb();
    // group lookup returns a group in a DIFFERENT org. Flows are org-scoped, so a
    // same-org group owned by another member is fine — but a foreign org's is not.
    resolve([{ id: 'g-foreign', userId: 'other-user', tenantId: 'other-org', pluginId: null }]);
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    let status = 0;
    try {
      await POST({
        locals: makeLocals(),
        request: new Request('http://x/api/flows', { method: 'POST', body: JSON.stringify({ name: 'X', groupId: 'g-foreign' }) }),
      } as Parameters<typeof POST>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(403);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('SECURITY: rejects a non-existent groupId with 404 and no insert', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // group lookup finds nothing
    mockGetFlowsCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    let status = 0;
    try {
      await POST({
        locals: makeLocals(),
        request: new Request('http://x/api/flows', { method: 'POST', body: JSON.stringify({ name: 'X', groupId: 'ghost' }) }),
      } as Parameters<typeof POST>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(404);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
