import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  resolveDepositRule: vi.fn(),
  writeDepositRule: vi.fn(),
}));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => mocks.requireOrgCapability(...args),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (...args: unknown[]) => mocks.getCoreCtx(...args),
}));
vi.mock('$server/services/crm-settings.service', () => ({
  resolveDepositRule: (...args: unknown[]) => mocks.resolveDepositRule(...args),
  writeDepositRule: (...args: unknown[]) => mocks.writeDepositRule(...args),
}));

import { GET, PUT } from './+server';

function event(body?: Record<string, unknown>) {
  return {
    locals: {
      user: { id: 'user-1', role: 'user', supabaseId: 'profile-1' },
      tenantCtx: { tenantId: 'org-1' },
    },
    request: body
      ? new Request('http://localhost/api/crm/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      : undefined,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
});

describe('GET /api/crm/settings', () => {
  it('requires crm:view before resolving the deposit rule', async () => {
    mocks.resolveDepositRule.mockResolvedValue({ keywords: [] });

    const response = await GET(event());

    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(expect.anything(), 'crm', 'view');
    expect(response.status).toBe(200);
  });

  it('rejects a role without crm:view before reading org settings', async () => {
    mocks.requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(GET(event())).rejects.toMatchObject({ status: 403 });
    expect(mocks.getCoreCtx).not.toHaveBeenCalled();
    expect(mocks.resolveDepositRule).not.toHaveBeenCalled();
  });
});

describe('PUT /api/crm/settings', () => {
  it('writes the deposit rule after the centrally-gated request body validates', async () => {
    mocks.writeDepositRule.mockResolvedValue({ deposit: { keywords: ['adelanto'] } });

    const response = await PUT(event({ deposit: { keywords: ['adelanto'] } }));

    expect(response.status).toBe(200);
    expect(mocks.writeDepositRule).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      { keywords: ['adelanto'] },
    );
  });
});
