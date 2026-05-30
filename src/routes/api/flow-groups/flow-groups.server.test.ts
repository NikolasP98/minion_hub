import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
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
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
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
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
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
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
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
