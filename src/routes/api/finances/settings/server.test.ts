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

beforeEach(() => vi.clearAllMocks());

/**
 * M1 regression: the write API used to accept `z.number().min(0).max(0.9999)`.
 * SUNAT's live validator rejects a document whose IGV rate is not currently in
 * force (fault soap-env:Client.3462, observed 2026-08-29 at 10%), so the API
 * must refuse the value rather than persist a setting that silently breaks
 * every later emission for the org.
 */
describe('PUT /api/finances/settings — taxRate must be a SUNAT-vigente IGV rate', () => {
  it.each([0.1, 0.08, 0.105, 0.19, 0, 0.9999, 18, -0.1])(
    'rejects taxRate %s with 400 and never calls the service',
    async (taxRate) => {
      // `expect().rejects` takes the value as-is (the pattern every other
      // route test in this repo already uses) — `RequestHandler` returns
      // `MaybePromise<Response>`, which is not assignable to a
      // `Promise<unknown>`-typed helper.
      await expect(PUT(put({ taxRate }))).rejects.toMatchObject({
        status: 400,
        body: { message: expect.stringContaining('SUNAT currently accepts') },
      });
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
