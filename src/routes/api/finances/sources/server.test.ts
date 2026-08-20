import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  getSource: vi.fn(),
  upsertSource: vi.fn(),
  encryptCreds: vi.fn(),
}));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => mocks.requireOrgCapability(...args),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (...args: unknown[]) => mocks.getCoreCtx(...args),
}));
vi.mock('$server/services/finance.service', () => ({
  getSource: (...args: unknown[]) => mocks.getSource(...args),
  upsertSource: (...args: unknown[]) => mocks.upsertSource(...args),
  sourceHasCredentials: (source: { secretRefs?: Record<string, unknown> }) =>
    !!(source.secretRefs?.ciphertext && source.secretRefs?.iv),
}));
vi.mock('$server/services/finance-secrets', () => ({
  encryptCreds: (...args: unknown[]) => mocks.encryptCreds(...args),
}));

import { PUT } from './+server';

const config = {
  ruc: '20611172967',
  clientId: 'client-id',
  legalName: 'FACES SOCIEDAD ANONIMA CERRADA',
};

function event(body: Record<string, unknown>) {
  return {
    locals: {
      user: { id: 'user-1', role: 'user', supabaseId: 'profile-1' },
      tenantCtx: { tenantId: 'org-1' },
    },
    request: new Request('http://localhost/api/finances/sources', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.encryptCreds.mockReturnValue({ ciphertext: 'cipher', iv: 'iv' });
});

describe('PUT /api/finances/sources', () => {
  it('requires finance:edit and encrypts a complete SUNAT credential set', async () => {
    const response = await PUT(
      event({
        provider: 'sunat-sire',
        config,
        username: 'SOLUSER',
        password: 'password',
        clientSecret: 'client-secret',
        enabled: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(expect.anything(), 'finance', 'edit');
    expect(mocks.encryptCreds).toHaveBeenCalledWith({
      username: 'SOLUSER',
      password: 'password',
      clientSecret: 'client-secret',
    });
    expect(mocks.upsertSource).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      'sunat-sire',
      expect.objectContaining({
        config,
        secretRefs: { ciphertext: 'cipher', iv: 'iv' },
        enabled: true,
      }),
    );
  });

  it('rejects a partial credential update before encryption or persistence', async () => {
    await expect(
      PUT(
        event({
          provider: 'sunat-sire',
          config,
          username: 'SOLUSER',
          password: '',
          clientSecret: 'client-secret',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(mocks.encryptCreds).not.toHaveBeenCalled();
    expect(mocks.upsertSource).not.toHaveBeenCalled();
  });

  it('preserves an existing encrypted credential blob when all secret fields are blank', async () => {
    mocks.getSource.mockResolvedValue({ secretRefs: { ciphertext: 'old-cipher', iv: 'old-iv' } });

    await PUT(event({ provider: 'sunat-sire', config, enabled: true }));

    expect(mocks.encryptCreds).not.toHaveBeenCalled();
    expect(mocks.upsertSource).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      'sunat-sire',
      expect.objectContaining({ secretRefs: { ciphertext: 'old-cipher', iv: 'old-iv' } }),
    );
  });
});
