import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  core: vi.fn(),
  server: vi.fn(),
  capability: vi.fn(),
  member: vi.fn(),
  account: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.core, getServerCtx: mocks.server }));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: mocks.capability }));
vi.mock('$server/services/whatsapp-readiness.service', () => ({
  getWhatsAppMemberReadiness: mocks.member,
  getWhatsAppAccountReadiness: mocks.account,
}));
import { GET as own } from './+server';
import { GET as account } from '../../servers/[id]/channels/[channelId]/readiness/+server';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.core.mockResolvedValue({ tenantId: 'org', profileId: 'own-profile' });
  mocks.server.mockResolvedValue({ tenantId: 'org', gatewayId: 'gateway' });
  mocks.member.mockResolvedValue({ ready: false });
  mocks.account.mockResolvedValue({ ready: false });
  mocks.capability.mockResolvedValue(undefined);
});
describe('readiness endpoint authority', () => {
  it('binds own readiness to the session profile and ignores forged actor parameters', async () => {
    await own({
      locals: { user: { id: 'legacy-user' } },
      url: new URL('http://localhost/?profileId=other&orgId=other&agentId=other&channelId=channel'),
    } as never);
    expect(mocks.member).toHaveBeenCalledWith({
      profileId: 'own-profile',
      orgId: 'org',
      channelId: 'channel',
    });
  });
  it('rejects non-session inspection', async () => {
    await expect(
      own({ locals: {}, url: new URL('http://localhost') } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it('requires channel edit capability before disclosing member readiness', async () => {
    mocks.capability.mockRejectedValue({ status: 403 });
    await expect(
      account({
        locals: {},
        params: { id: 'server', channelId: 'channel' },
        url: new URL('http://localhost'),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.capability).toHaveBeenCalledWith({}, 'channels', 'edit');
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it('uses the canonical server scope and explicitly paginates administrative status', async () => {
    await account({
      locals: {},
      params: { id: 'server', channelId: 'channel' },
      url: new URL('http://localhost/?orgId=forged&limit=4&cursor=cursor'),
    } as never);
    expect(mocks.account).toHaveBeenCalledWith(
      { orgId: 'org', gatewayId: 'gateway', channelId: 'channel' },
      { limit: 4, cursor: 'cursor' },
    );
  });
});
