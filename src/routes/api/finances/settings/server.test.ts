import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateFinSettings = vi.fn<(...a: never[]) => Promise<unknown>>(async () => ({}));

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: async () => {},
}));
vi.mock('$server/services/finance.service', () => ({
  getFinSettings: async () => ({ taxRate: 0.18 }),
  refreshExchangeRate: async () => ({ taxRate: 0.18 }),
  updateFinSettings: (...a: never[]) => updateFinSettings(...a),
}));

import { PUT } from './+server';

function put(body: unknown) {
  return {
    locals: {},
    request: new Request('http://x/api/finances/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

/** SvelteKit `error()` throws an object carrying status + body, not a Response. */
async function statusOf(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await promise;
    return { status: 200, message: '' };
  } catch (e) {
    const err = e as { status?: number; body?: { message?: string } };
    return { status: err.status ?? 0, message: err.body?.message ?? String(e) };
  }
}

beforeEach(() => vi.clearAllMocks());

/**
 * M1 regression: the write API used to accept `z.number().min(0).max(0.9999)`.
 * SUNAT's live validator rejects a document whose IGV rate is not currently in
 * force (fault soap-env:Client.3462, observed 2026-08-28 at 10%), so the API
 * must refuse the value rather than persist a setting that silently breaks
 * every later emission for the org.
 */
describe('PUT /api/finances/settings — taxRate must be a SUNAT-vigente IGV rate', () => {
  it.each([0.1, 0.08, 0.105, 0.19, 0, 0.9999, 18, -0.1])(
    'rejects taxRate %s with 400 and never calls the service',
    async (taxRate) => {
      const { status, message } = await statusOf(PUT(put({ taxRate })));
      expect(status).toBe(400);
      expect(message).toMatch(/SUNAT currently accepts/);
      expect(updateFinSettings).not.toHaveBeenCalled();
    },
  );

  it('accepts 0.18 and forwards it to the service', async () => {
    updateFinSettings.mockResolvedValue({ taxRate: 0.18 });
    const res = (await PUT(put({ taxRate: 0.18, currency: 'PEN' }))) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: { taxRate: 0.18 } });
    expect(updateFinSettings).toHaveBeenCalledTimes(1);
    expect(updateFinSettings.mock.calls[0][1]).toMatchObject({ taxRate: 0.18 });
  });

  it('a body with no taxRate is still accepted (the field stays optional)', async () => {
    updateFinSettings.mockResolvedValue({ taxRate: 0.18 });
    const res = (await PUT(put({ currency: 'USD' }))) as Response;
    expect(res.status).toBe(200);
    expect(updateFinSettings).toHaveBeenCalledTimes(1);
    expect(updateFinSettings.mock.calls[0][1]).toEqual({ currency: 'USD' });
  });
});
