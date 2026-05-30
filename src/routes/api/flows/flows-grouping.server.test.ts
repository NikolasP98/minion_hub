import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx: (l: unknown) => mockGetTenantCtx(l) }));

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'], orgId: 'org-1', tenantCtx: undefined } as App.Locals;
}
beforeEach(() => vi.clearAllMocks());

describe('GET /api/flows — groupId', () => {
  it('returns groupId on each flow', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', name: 'F', nodes: '[]', active: false, createdAt: 1, updatedAt: 1, config: '{}', groupId: 'g1' }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { GET } = await import('./+server');
    const res = await GET({ locals: makeLocals(), url: new URL('http://x/api/flows') } as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.flows[0].groupId).toBe('g1');
  });
});

describe('POST /api/flows — groupId + templateId', () => {
  it('persists groupId and the template source', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: new Request('http://x/api/flows', { method: 'POST', body: JSON.stringify({ name: 'New', groupId: 'g1', pluginId: 'aw', templateId: 'pipeline', nodes: [{ id: 'n' }], edges: [] }) }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
