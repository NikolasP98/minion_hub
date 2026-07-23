import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createGateway: vi.fn(),
  assertSafeUrl: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAdmin: () => ({ id: 'user-1', role: 'admin', supabaseId: 'profile-1' }),
}));

vi.mock('$server/services/gateway.pg.service', () => ({
  createGateway: mocks.createGateway,
  listGatewaysForAdmin: vi.fn(),
}));

vi.mock('$server/services/ssrf-guard', () => ({
  assertSafeUrl: mocks.assertSafeUrl,
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

import { POST } from './+server';

describe('POST /api/gateways', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGateway.mockResolvedValue({ id: 'gateway-1' });
  });

  test('assigns a newly created gateway to the active organization', async () => {
    const response = await POST({
      locals: { orgId: 'org-active' },
      request: new Request('https://hub.example/api/gateways', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Production', url: 'wss://gateway.example', token: 'secret' }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.createGateway).toHaveBeenCalledWith({
      name: 'Production',
      url: 'wss://gateway.example',
      token: 'secret',
      profileId: 'profile-1',
      orgId: 'org-active',
    });
  });
});
