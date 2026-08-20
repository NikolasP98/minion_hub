import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  getSource: vi.fn(),
  decryptCreds: vi.fn(),
  probeSunatCredentials: vi.fn(),
  setSourceProbe: vi.fn(),
}));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => mocks.requireOrgCapability(...args),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (...args: unknown[]) => mocks.getCoreCtx(...args),
}));
vi.mock('$server/services/finance.service', () => ({
  getSource: (...args: unknown[]) => mocks.getSource(...args),
  setSourceProbe: (...args: unknown[]) => mocks.setSourceProbe(...args),
}));
vi.mock('$server/services/finance-secrets', () => ({
  decryptCreds: (...args: unknown[]) => mocks.decryptCreds(...args),
}));
vi.mock('$server/finance/connectors/sunat-source', () => ({
  probeSunatCredentials: (...args: unknown[]) => mocks.probeSunatCredentials(...args),
  classifySunatProbeError: () => ({
    status: 'invalid',
    message: 'SUNAT rejected the stored credentials.',
  }),
}));

import { POST } from './+server';

function event() {
  return {
    locals: {
      user: { id: 'user-1', role: 'user', supabaseId: 'profile-1' },
      tenantCtx: { tenantId: 'org-1' },
    },
    request: new Request('http://localhost/api/finances/sources/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'sunat-sire' }),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.getSource.mockResolvedValue({
    provider: 'sunat-sire',
    enabled: true,
    config: { ruc: '20611172967', clientId: 'id', legalName: 'FACES SAC' },
    secretRefs: { ciphertext: 'cipher', iv: 'iv' },
  });
  mocks.decryptCreds.mockReturnValue({
    username: 'SOLUSER',
    password: 'password',
    clientSecret: 'client-secret',
  });
});

describe('POST /api/finances/sources/probe', () => {
  it('requires finance:edit and persists successful live evidence', async () => {
    mocks.probeSunatCredentials.mockResolvedValue({
      status: 'valid',
      latencyMs: 42,
      periodCount: 3,
      latestPeriod: '202608',
      openPeriodCount: 1,
    });

    const response = await POST(event());
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(expect.anything(), 'finance', 'edit');
    expect(mocks.probeSunatCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ ruc: '20611172967' }),
      expect.objectContaining({ username: 'SOLUSER' }),
    );
    expect(mocks.setSourceProbe).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      'sunat-sire',
      expect.objectContaining({
        status: 'valid',
        message: 'Credentials validated live with SUNAT.',
      }),
    );
    expect(await response.json()).toMatchObject({ ok: true, status: 'valid', periodCount: 3 });
  });

  it('returns a sanitized invalid result and records it without deleting credentials', async () => {
    mocks.probeSunatCredentials.mockRejectedValue(new Error('raw upstream body'));

    const response = await POST(event());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: false,
      status: 'invalid',
      message: 'SUNAT rejected the stored credentials.',
    });
    expect(mocks.setSourceProbe).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      'sunat-sire',
      expect.objectContaining({ status: 'invalid' }),
    );
  });
});
