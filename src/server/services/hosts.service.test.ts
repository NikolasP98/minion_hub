import { describe, it, expect, vi, beforeEach } from 'vitest';

let orgChannels: string[] = ['prd'];
const listGatewayHostsForUser = vi.fn();
const linkOrgGatewaysToUser = vi.fn();
vi.mock('./gateway.pg.service', () => ({
  listGatewayHostsForUser: (...a: unknown[]) => listGatewayHostsForUser(...a),
  linkOrgGatewaysToUser: (...a: unknown[]) => linkOrgGatewaysToUser(...a),
  listOrgChannels: async () => orgChannels,
}));
vi.mock('./gateway-lease.service', () => ({ resolveChannelEndpoint: async () => null }));

import { loadHostsForUser } from './hosts.service';

const host = {
  id: 'gw-1',
  name: 'minion-1',
  url: 'wss://x',
  lastConnectedAt: null,
  orgId: 'org-1',
  channel: 'prd',
};
const ctx = { user: { supabaseId: 'profile-1' }, orgId: 'org-1' } as never;

beforeEach(() => {
  orgChannels = ['prd'];
  listGatewayHostsForUser.mockReset();
  linkOrgGatewaysToUser.mockReset();
});

describe('loadHostsForUser', () => {
  it('links a member with no host to the org gateway and re-lists (join-link / admin-created members)', async () => {
    listGatewayHostsForUser.mockResolvedValueOnce([]).mockResolvedValueOnce([host]);
    linkOrgGatewaysToUser.mockResolvedValueOnce(true);

    const res = await loadHostsForUser(ctx, 'user-1', 'user');

    expect(linkOrgGatewaysToUser).toHaveBeenCalledWith('profile-1', 'org-1');
    expect(res.servers).toEqual([host]);
    expect(res.orgAssignedHostId).toBe('gw-1');
  });

  it('stays empty (no second list) when the org has no gateway to link', async () => {
    orgChannels = [];
    listGatewayHostsForUser.mockResolvedValueOnce([]);
    linkOrgGatewaysToUser.mockResolvedValueOnce(false);

    const res = await loadHostsForUser(ctx, 'user-1', 'user');

    expect(listGatewayHostsForUser).toHaveBeenCalledTimes(1);
    expect(res.servers).toEqual([]);
  });

  it('links when the org has a channel the member cannot see yet (dev added later)', async () => {
    orgChannels = ['prd', 'dev'];
    const dev = { ...host, id: 'gw-2', channel: 'dev' };
    listGatewayHostsForUser.mockResolvedValueOnce([host]).mockResolvedValueOnce([host, dev]);
    linkOrgGatewaysToUser.mockResolvedValueOnce(true);

    const res = await loadHostsForUser(ctx, 'user-1', 'user');

    expect(linkOrgGatewaysToUser).toHaveBeenCalledWith('profile-1', 'org-1');
    expect(res.servers).toEqual([host, dev]);
  });

  it('never self-links for admins or when every org channel is already visible', async () => {
    orgChannels = ['prd'];
    listGatewayHostsForUser.mockResolvedValueOnce([]);
    await loadHostsForUser(ctx, 'user-1', 'admin');
    listGatewayHostsForUser.mockResolvedValueOnce([host]);
    await loadHostsForUser(ctx, 'user-1', 'user');

    expect(linkOrgGatewaysToUser).not.toHaveBeenCalled();
  });
});
