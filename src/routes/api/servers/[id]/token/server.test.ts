import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGatewayTokenByServerId: vi.fn(),
  getServerToken: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAuth: () => ({ id: 'user-1', role: 'admin', supabaseId: 'profile-1' }),
}));

vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));

vi.mock('$server/services/server.service', () => ({
  getServerToken: mocks.getServerToken,
}));

vi.mock('$server/services/gateway.pg.service', () => ({
  userHasGatewayAccess: vi.fn(),
  getGatewayTokenByServerId: mocks.getGatewayTokenByServerId,
}));

import { POST } from './+server';

function event() {
  return {
    locals: { user: { email: 'admin@example.com', role: 'admin' } },
    params: { id: 'server-1' },
  } as never;
}

describe('POST /api/servers/[id]/token', () => {
  beforeEach(() => {
    mocks.getGatewayTokenByServerId.mockReset();
    mocks.getServerToken.mockReset();
  });

  test('returns 503 instead of a false 404 when PG is unavailable', async () => {
    mocks.getGatewayTokenByServerId.mockRejectedValue(
      new Error('EMAXCONN max client connections reached'),
    );
    mocks.getServerToken.mockResolvedValue(null);

    const response = await POST(event());

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('2');
    await expect(response.json()).resolves.toEqual({
      error: 'Gateway registry temporarily unavailable',
    });
  });

  test('keeps a genuine registry miss as 404', async () => {
    mocks.getGatewayTokenByServerId.mockResolvedValue(null);
    mocks.getServerToken.mockResolvedValue(null);

    const response = await POST(event());

    expect(response.status).toBe(404);
  });

  test('returns the PG gateway token without consulting Turso', async () => {
    mocks.getGatewayTokenByServerId.mockResolvedValue('gateway-secret');

    const response = await POST(event());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token: 'gateway-secret' });
    expect(mocks.getServerToken).not.toHaveBeenCalled();
  });
});
