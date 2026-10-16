import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ principal: vi.fn(), feed: vi.fn(), credential: vi.fn() }));
vi.mock('$server/auth/assistant-principal', () => ({ resolveAssistantPrincipal: mocks.principal }));
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx: async () => ({ tenantId: 'org' }) }));
vi.mock('$server/services/shared-identity.service', () => ({
  resolveFeedGoogleCredentials: mocks.feed,
}));
vi.mock('$server/services/identity.service', () => ({ getGoogleCredential: mocks.credential }));
import { GET as identities } from './+server';
import { GET as adc } from '../google-adc/+server';
function event() {
  return {
    locals: { serverId: 'gateway', tenantCtx: { tenantId: 'org' } },
    url: new URL('https://hub.test/api/gateway/google-identities?agentId=personal-alice'),
  } as unknown as Parameters<typeof identities>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.principal.mockResolvedValue({ principalId: 'alice', orgId: 'org' });
  mocks.feed.mockResolvedValue([]);
  mocks.credential.mockResolvedValue({ email: 'alice@example.test', adc: 'fixture' });
});
describe('gateway credentials bind canonical assistant authority', () => {
  it('uses resolved profile and org rather than accepting arbitrary userId', async () => {
    const response = await identities(event());
    expect(mocks.feed).toHaveBeenCalledWith(expect.anything(), 'alice', 'org');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await adc(event());
    expect(mocks.credential).toHaveBeenCalledWith(expect.anything(), 'alice');
  });
  it('denies both credential endpoints before decrypting when assignment is unavailable', async () => {
    mocks.principal.mockRejectedValue({ status: 403 });
    await expect(identities(event())).rejects.toMatchObject({ status: 403 });
    await expect(adc(event())).rejects.toMatchObject({ status: 403 });
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(mocks.credential).not.toHaveBeenCalled();
  });
});
