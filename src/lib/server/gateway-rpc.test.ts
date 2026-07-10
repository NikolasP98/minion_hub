/**
 * resolveCredentialsForUser fallback-order tests (per-org volume tenancy §3.4):
 * org-assigned gateway → PG per-user → PG system → env bootstrap.
 *
 * `gateway.org_id` is a mutable assignment (lease read-model), not ownership.
 * The hard requirement under test: with no org assignment (or no orgId), the
 * chain behaves byte-identically to the pre-tenancy behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrg = vi.fn<(orgId: string) => Promise<{ url: string; token: string } | null>>();
const mockUser = vi.fn<(profileId: string) => Promise<{ url: string; token: string } | null>>();
const mockSystem =
  vi.fn<(preferredUrl?: string) => Promise<{ url: string; token: string } | null>>();
vi.mock('$server/services/gateway.pg.service', () => ({
  getOrgAssignedGatewayCredentials: (orgId: string) => mockOrg(orgId),
  getUserGatewayCredentials: (profileId: string) => mockUser(profileId),
  getSystemGatewayCredentials: (preferredUrl?: string) => mockSystem(preferredUrl),
}));

import { resolveCredentialsForUser, gatewayCall, pluginsUiList } from './gateway-rpc';

beforeEach(() => {
  vi.clearAllMocks();
  mockOrg.mockResolvedValue(null);
  mockUser.mockResolvedValue(null);
  mockSystem.mockResolvedValue(null);
});

describe('gateway-rpc helper', () => {
  it('exports gatewayCall and pluginsUiList', () => {
    expect(typeof gatewayCall).toBe('function');
    expect(typeof pluginsUiList).toBe('function');
  });
});

describe('resolveCredentialsForUser', () => {
  it('org-assigned gateway wins when the active org has one', async () => {
    mockOrg.mockResolvedValue({ url: 'https://org-gw', token: 'org-tok' });
    mockUser.mockResolvedValue({ url: 'wss://user-gw', token: 'user-tok' });

    const creds = await resolveCredentialsForUser('p1', 'org-A');
    expect(creds).toEqual({ url: 'wss://org-gw', token: 'org-tok' });
    expect(mockOrg).toHaveBeenCalledWith('org-A');
    expect(mockUser).not.toHaveBeenCalled();
  });

  it('falls through to the per-user chain when the org has no assignment', async () => {
    mockUser.mockResolvedValue({ url: 'wss://user-gw', token: 'user-tok' });

    const creds = await resolveCredentialsForUser('p1', 'org-A');
    expect(mockOrg).toHaveBeenCalledWith('org-A');
    expect(creds).toEqual({ url: 'wss://user-gw', token: 'user-tok' });
  });

  it('never consults the org lookup without an orgId (old chain unchanged)', async () => {
    mockUser.mockResolvedValue({ url: 'wss://user-gw', token: 'user-tok' });

    const creds = await resolveCredentialsForUser('p1');
    expect(mockOrg).not.toHaveBeenCalled();
    expect(creds).toEqual({ url: 'wss://user-gw', token: 'user-tok' });
  });

  it('degrades an org-lookup failure to the fallback chain instead of throwing', async () => {
    mockOrg.mockRejectedValue(new Error('pg down'));
    mockSystem.mockResolvedValue({ url: 'wss://sys-gw', token: 'sys-tok' });

    const creds = await resolveCredentialsForUser(undefined, 'org-A');
    expect(creds).toEqual({ url: 'wss://sys-gw', token: 'sys-tok' });
  });
});
