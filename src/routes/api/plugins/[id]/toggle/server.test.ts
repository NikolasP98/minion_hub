import { error } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  listHosts: vi.fn(),
  resolveGatewayId: vi.fn(),
  setDisabled: vi.fn(),
  gatewayCall: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: m.requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: m.getCoreCtx }));
vi.mock('$server/services/gateway.pg.service', () => ({
  listGatewayHostsForUser: m.listHosts,
  resolveGatewayId: m.resolveGatewayId,
}));
vi.mock('$server/services/org-config-sync.service', () => ({
  setPluginDisabledForOrg: m.setDisabled,
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: m.gatewayCall }));

import { POST } from './+server';

const call = () =>
  POST({
    locals: { user: { id: 'u', role: 'user' } },
    params: { id: 'whatsapp' },
    request: new Request('http://x', { method: 'POST', body: JSON.stringify({ enabled: false }) }),
  } as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  m.getCoreCtx.mockResolvedValue({ tenantId: 'org-a', profileId: 'p' });
  m.listHosts.mockResolvedValue([{ id: 'srv-1' }]);
  m.resolveGatewayId.mockResolvedValue('gw-1');
  m.gatewayCall.mockResolvedValue({ ok: true, restartRequired: false });
});

describe('POST /api/plugins/[id]/toggle (spec 045 N4)', () => {
  it('403s a plain member before any write or gateway call', async () => {
    m.requireOrgCapability.mockImplementation(async () => error(403, 'settings: manage required'));
    await expect(call()).rejects.toMatchObject({ status: 403 });
    expect(m.requireOrgCapability).toHaveBeenCalledWith(expect.anything(), 'settings', 'manage');
    expect(m.setDisabled).not.toHaveBeenCalled();
    expect(m.gatewayCall).not.toHaveBeenCalled();
  });

  it('lets an org owner/admin or platform admin through', async () => {
    m.requireOrgCapability.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(200);
    expect(m.setDisabled).toHaveBeenCalledWith(expect.anything(), 'gw-1', 'whatsapp', true);
    expect(m.gatewayCall).toHaveBeenCalledWith('plugins.org.set', {
      pluginId: 'whatsapp',
      orgId: 'org-a',
      enabled: false,
    });
  });

  it('settings:manage is held by owner and admin, not by a member', async () => {
    const { defaultCaps, legacyRoleKey } = await vi.importActual<
      typeof import('$server/services/rbac.service')
    >('$server/services/rbac.service');
    const canManage = (role: string) => defaultCaps(legacyRoleKey(role), 'settings').manage;
    expect(['owner', 'admin', 'member'].map(canManage)).toEqual([true, true, false]);
  });
});
