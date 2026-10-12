import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleWriteError } from '$server/services/errors';

const SETTINGS = {
  methods: [],
  currency: 'PEN',
  requireCustomer: false,
  allowPriceOverride: false,
  emission: { mode: 'off', docTypeDefault: '03' },
  requirements: { identityDocument: 'off', phone: 'off' },
  currencyIssue: null,
  supportedCurrencies: ['PEN'],
  paymentPolicyRevision: 'r1',
  updatedAt: new Date('2026-06-02T00:00:00Z'),
};
const state = vi.hoisted(() => ({
  update: vi.fn(async (_ctx: unknown, _patch: unknown, _expected?: Date): Promise<unknown> => ({})),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: () => Promise.resolve(),
}));
vi.mock('$server/services/pos.service', () => ({
  getPosSettings: () => Promise.resolve(SETTINGS),
  updatePosSettings: (ctx: unknown, patch: unknown, expected?: Date) =>
    state.update(ctx, patch, expected),
}));

const { PUT } = await import('./+server');
const put = (body: unknown) =>
  PUT({
    locals: {},
    request: new Request('http://x', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  state.update.mockResolvedValue(SETTINGS);
});

describe('PUT /api/pos/settings — stale-write guard', () => {
  it('threads a fresh expectedUpdatedAt (not as a settings field) and answers the new token', async () => {
    const res = await put({
      requirements: { phone: 'required' },
      expectedUpdatedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      { requirements: { phone: 'required' } },
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect((await res.json()).settings.updatedAt).toBe('2026-06-02T00:00:00.000Z');
  });

  it('answers 409 { error: stale, current } for a stale token', async () => {
    state.update.mockRejectedValueOnce(new StaleWriteError(SETTINGS));
    const res = await put({
      requirements: { phone: 'required' },
      expectedUpdatedAt: '2020-01-01T00:00:00Z',
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('stale');
    expect(body.current.requirements).toEqual(SETTINGS.requirements);
  });
});
