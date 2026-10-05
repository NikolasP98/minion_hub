import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosError } from '$server/services/pos/errors';

const state = vi.hoisted(() => ({
  ctx: { tenantId: 'org-1', profileId: 'actor-1', db: {} } as object | null,
  enabled: true,
  required: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => state.ctx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: async () => state.enabled }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => state.required(...args),
}));
vi.mock('$server/services/pos/wallet-identity', () => ({
  resolveWalletIdentityForAdmission: (...args: unknown[]) => state.resolve(...args),
}));

import { GET } from './+server';

const partyId = '10000000-0000-4000-8000-000000000001';
const contactId = '20000000-0000-4000-8000-000000000001';

function event(query = `partyId=${partyId}&crmContactId=${contactId}`) {
  return {
    locals: {},
    url: new URL(`http://hub.test/api/pos/plans/identity?${query}`),
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  state.ctx = { tenantId: 'org-1', profileId: 'actor-1', db: {} };
  state.enabled = true;
  state.resolve.mockResolvedValue({
    partyId,
    crmContactId: contactId,
    clientKey: `party:${partyId}`,
    identityStatus: 'active',
  });
});

describe('plan wallet-identity preflight', () => {
  it('returns only the canonical active facets under create authority and disables caching', async () => {
    const response = await GET(event());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      partyId,
      crmContactId: contactId,
      clientKey: `party:${partyId}`,
      identityStatus: 'active',
    });
    expect(state.required).toHaveBeenCalledExactlyOnceWith({}, 'pos', 'create');
    expect(state.resolve).toHaveBeenCalledExactlyOnceWith(state.ctx, {
      partyId,
      crmContactId: contactId,
    });
  });

  it('rejects missing/malformed facets before the resolver', async () => {
    await expect(GET(event(''))).rejects.toMatchObject({ status: 400 });
    await expect(GET(event('partyId=not-a-uuid'))).rejects.toMatchObject({ status: 400 });
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it('preserves typed relink and unavailable failures without returning identity data', async () => {
    state.resolve.mockRejectedValue(
      new PosError('Wallet identity changed.', 'wallet_identity_changed'),
    );
    const response = await GET(event());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Wallet identity changed.',
      code: 'wallet_identity_changed',
    });
  });

  it('denies absent identity, disabled POS and revoked create authority before resolution', async () => {
    state.ctx = null;
    await expect(GET(event())).rejects.toMatchObject({ status: 401 });
    state.ctx = {};
    state.enabled = false;
    await expect(GET(event())).rejects.toMatchObject({ status: 404 });
    state.enabled = true;
    state.required.mockRejectedValue({ status: 403 });
    await expect(GET(event())).rejects.toMatchObject({ status: 403 });
    expect(state.resolve).not.toHaveBeenCalled();
  });
});
