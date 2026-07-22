import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  requireCoreCtx: vi.fn(),
  update: vi.fn(),
}));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => mocks.requireOrgCapability(...args),
}));
vi.mock('$server/auth/core-ctx', () => ({
  requireCoreCtx: (...args: unknown[]) => mocks.requireCoreCtx(...args),
}));
vi.mock('$server/services/brain-enrichment-settings.service', async () => {
  const { z } = await import('zod');
  return {
    brainEnrichmentSettingsInputSchema: z.unknown(),
    getBrainEnrichmentPlatformState: vi.fn(),
    getBrainEnrichmentSettingsState: vi.fn(),
    listBrainEnrichmentAdapterIds: vi.fn(),
    listBrainEnrichmentModelCatalog: vi.fn(),
    updateBrainEnrichmentConfig: (...args: unknown[]) => mocks.update(...args),
  };
});

import { PUT } from './+server';

function event() {
  return {
    locals: {
      user: { id: 'user-1', role: 'user', supabaseId: 'profile-1', email: 'member@example.com' },
      tenantCtx: { tenantId: 'org-1' },
    },
    request: new Request('http://localhost/api/brains/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('PUT /api/brains/settings', () => {
  it('rejects a manager with brains:manage before parsing or persisting settings', async () => {
    mocks.requireOrgCapability.mockResolvedValue({ roles: ['manager'], can: () => true });

    await expect(PUT(event())).rejects.toMatchObject({ status: 403 });

    expect(mocks.requireCoreCtx).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
