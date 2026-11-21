import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  can: vi.fn(),
  list: vi.fn(),
  end: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: async () => ({ tenantId: 'org-1' }) }));
vi.mock('$server/services/rbac.service', () => ({ hasOrgCapability: m.can }));
vi.mock('$server/mcp/oauth.service', () => ({ listConnections: m.list, endConnection: m.end }));

import { GET } from './+server';
import { DELETE } from './[id]/+server';

const locals = { user: { supabaseId: 'u1' }, tenantCtx: { tenantId: 'org-1' } };
const ID = '11111111-1111-4111-8111-111111111111';
const del = (id = ID) => DELETE({ locals, params: { id } } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  m.can.mockResolvedValue(false);
  m.list.mockResolvedValue([]);
});

describe('GET /api/settings/mcp-connections', () => {
  it("lists only the viewer's own without settings:manage, every one of the org with it", async () => {
    await GET({ locals } as never);
    expect(m.list).toHaveBeenLastCalledWith('org-1', 'u1', false);
    m.can.mockResolvedValue(true);
    await GET({ locals } as never);
    expect(m.list).toHaveBeenLastCalledWith('org-1', 'u1', true);
  });

  it('401s without a session', async () => {
    await expect(GET({ locals: {} } as never)).rejects.toMatchObject({ status: 401 });
  });
});

describe('DELETE /api/settings/mcp-connections/[id]', () => {
  it('a person ends their own connection', async () => {
    m.end.mockResolvedValueOnce(true);
    expect((await del()).status).toBe(200);
    expect(m.end).toHaveBeenCalledWith(ID, 'u1', { userId: 'u1' });
  });

  it("a member without settings:manage cannot end someone else's: 404", async () => {
    m.end.mockResolvedValue(false);
    expect((await del()).status).toBe(404);
    expect(m.end).toHaveBeenCalledTimes(1);
  });

  it('settings:manage ends any connection of the active organization only', async () => {
    m.can.mockResolvedValue(true);
    m.end.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect((await del()).status).toBe(200);
    expect(m.end).toHaveBeenLastCalledWith(ID, 'u1', { orgId: 'org-1' });
  });

  it('an unknown or malformed id is 404 and changes nothing', async () => {
    expect((await del('not-a-uuid')).status).toBe(404);
    expect(m.end).not.toHaveBeenCalled();
  });
});
