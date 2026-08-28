import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSource = vi.fn();
const mockUpsertSource = vi.fn();
const mockEncryptCreds = vi.fn((_c: unknown) => ({ ciphertext: 'CT', iv: 'IV' }));
const mockCount = vi.fn<() => Promise<number | null>>();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: async () => null }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/finance.service', () => ({
  getSource: (...a: unknown[]) => mockGetSource(...a),
  upsertSource: (...a: unknown[]) => mockUpsertSource(...a),
  sourceHasCredentials: (..._a: unknown[]) => true,
}));
vi.mock('$server/services/finance-secrets', () => ({
  encryptCreds: (c: unknown) => mockEncryptCreds(c),
}));
vi.mock('$server/finance/connector', () => ({
  getConnector: () => ({ provider: 'susii', count: () => mockCount() }),
}));
vi.mock('$server/finance/connectors/susii-connector', () => ({}));

const { PUT } = await import('./+server');

function req(body: unknown) {
  return new Request('http://x/api/finances/sources', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const call = (body: unknown) =>
  (PUT as unknown as (e: { locals: unknown; request: Request }) => Promise<Response>)({
    locals: {},
    request: req(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockResolvedValue(42);
  mockGetSource.mockResolvedValue({ secretRefs: { ciphertext: 'OLD', iv: 'OLDIV' } });
});

describe('PUT /api/finances/sources credential handling', () => {
  // The Aug-2026 bug: a password-only submit fell into "preserve existing" and
  // returned ok:true having stored nothing, so the sync kept using the old
  // credential and the user believed they had updated it.
  it('rejects a password without a username instead of silently keeping the old one', async () => {
    await expect(
      call({ config: { businessId: null }, password: 'new-pass' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(mockUpsertSource).not.toHaveBeenCalled();
    expect(mockEncryptCreds).not.toHaveBeenCalled();
  });

  it('rejects a username without a password', async () => {
    await expect(call({ config: { businessId: null }, username: 'user' })).rejects.toMatchObject({
      status: 400,
    });
    expect(mockUpsertSource).not.toHaveBeenCalled();
  });

  it('refuses to store credentials the provider rejects', async () => {
    mockCount.mockRejectedValue(new Error('susii login failed: 400 — bad credentials'));
    await expect(
      call({ config: { businessId: null }, username: 'u', password: 'bad' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockEncryptCreds).not.toHaveBeenCalled();
    expect(mockUpsertSource).not.toHaveBeenCalled();
  });

  it('stores credentials the provider accepts and reports verified:true', async () => {
    const res = await call({ config: { businessId: null }, username: 'u', password: 'good' });
    expect(res.status).toBe(200);
    expect(mockEncryptCreds).toHaveBeenCalledWith({ username: 'u', password: 'good' });
    expect(mockUpsertSource).toHaveBeenCalled();
    // The UI shows "credentials verified" off this flag; `last_status` still
    // says 'failed' until the next sync, so without it a good save looks broken.
    expect(await res.json()).toMatchObject({ ok: true, verified: true });
  });

  it('keeps the stored credentials when BOTH fields are blank (config-only edit)', async () => {
    const res = await call({ config: { businessId: null }, enabled: true });
    expect(res.status).toBe(200);
    expect(mockCount).not.toHaveBeenCalled(); // no probe when nothing changed
    expect(mockUpsertSource).toHaveBeenCalledWith(
      expect.anything(),
      'susii',
      expect.objectContaining({ secretRefs: { ciphertext: 'OLD', iv: 'OLDIV' } }),
    );
  });
});
