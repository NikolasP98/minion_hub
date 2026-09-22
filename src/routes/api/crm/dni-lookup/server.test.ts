import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dniPreview: vi.fn(), getCoreCtx: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: { PERUDEVS_API_KEY: 'test-key' } }));
vi.mock('@minion-stack/crm-sdk', () => ({
  isDni8: (value: string) => /^\d{8}$/.test(value),
  dniPreview: mocks.dniPreview,
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));

import { POST } from './+server';

describe('POST /api/crm/dni-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  });

  it('returns the requested DNI even when the provider preview exposes a different id', async () => {
    mocks.dniPreview.mockResolvedValue({
      status: 'found',
      preview: { dni: 'provider-person-id', name: 'ANA TEST', dob: '2000-01-02', sex: 'F' },
    });
    const response = await POST({
      locals: {},
      request: new Request('https://hub.test/api/crm/dni-lookup', {
        method: 'POST',
        body: JSON.stringify({ dni: '60525600' }),
      }),
    } as never);
    expect(await response.json()).toMatchObject({ found: true, dni: '60525600', name: 'ANA TEST' });
  });
});
