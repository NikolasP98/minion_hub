import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getServerCtx, resolveGatewayId, resolveServerId } = vi.hoisted(() => ({
  getServerCtx: vi.fn(),
  resolveGatewayId: vi.fn(),
  resolveServerId: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getServerCtx }));
vi.mock('$server/services/gateway.pg.service', () => ({ resolveGatewayId, resolveServerId }));

import { requireBuilderGatewayAccess, requireBuilderServerAccess } from './builder-access';

function locals(role: 'admin' | 'user'): App.Locals {
  return {
    user: {
      id: 'user-1',
      supabaseId: 'profile-1',
      role,
      email: 'builder@minion.test',
      displayName: 'Builder',
    },
  } as App.Locals;
}

describe('builder gateway access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveGatewayId.mockResolvedValue('gateway-1');
    resolveServerId.mockResolvedValue('server-1');
  });

  test('validates gateway existence even for a platform admin', async () => {
    resolveGatewayId.mockResolvedValue(null);
    await expect(requireBuilderServerAccess(locals('admin'), 'missing')).rejects.toMatchObject({
      status: 404,
    });
    expect(getServerCtx).not.toHaveBeenCalled();
  });

  test('allows an admin to use an existing gateway without a user_gateway link', async () => {
    await expect(requireBuilderServerAccess(locals('admin'), 'server-1')).resolves.toBeUndefined();
    expect(getServerCtx).not.toHaveBeenCalled();
  });

  test('rechecks the current user_gateway link when a draft is published', async () => {
    getServerCtx.mockResolvedValue(null);
    await expect(requireBuilderGatewayAccess(locals('user'), 'gateway-1')).rejects.toMatchObject({
      status: 403,
    });
    expect(resolveServerId).toHaveBeenCalledWith('gateway-1');
    expect(getServerCtx).toHaveBeenCalledWith(expect.anything(), 'server-1');
  });
});
