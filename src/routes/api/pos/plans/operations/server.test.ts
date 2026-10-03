import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosError } from '$server/services/pos/errors';
const state = vi.hoisted(() => ({
  ctx: { tenantId: 'org', profileId: 'actor', db: {} } as object | null,
  enabled: true,
  required: vi.fn(),
  lookup: vi.fn(),
  cancel: vi.fn(),
  create: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => state.ctx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: async () => state.enabled }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => state.required(...args),
}));
vi.mock('$server/services/pos/plan-operation', () => ({
  lookupOwnPlanOperation: (...args: unknown[]) => state.lookup(...args),
  cancelPlanOperation: (...args: unknown[]) => state.cancel(...args),
}));
vi.mock('$server/services/pos-accounts.service', () => ({
  createPlan: (...args: unknown[]) => state.create(...args),
  listPlans: vi.fn(),
  PLAN_STATUSES: [],
}));
import { GET } from './[operationId]/+server';
import { POST as cancel } from './[operationId]/cancel/+server';
import { POST as create } from '../+server';
const operationId = '60000000-0000-4000-8000-000000000001';
function event() {
  return { locals: {}, params: { operationId } } as never;
}
beforeEach(() => {
  vi.resetAllMocks();
  state.ctx = { tenantId: 'org', profileId: 'actor', db: {} };
  state.enabled = true;
  state.lookup.mockResolvedValue({ id: 'plan' });
  state.cancel.mockResolvedValue({ status: 'cancelled' });
});
describe('plan operation HTTP boundaries', () => {
  it('returns only an own-operation receipt under create authority and disables caching', async () => {
    const response = await GET(event());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ plan: { id: 'plan' } });
    expect(state.required).toHaveBeenCalledExactlyOnceWith({}, 'pos', 'create');
    expect(state.lookup).toHaveBeenCalledExactlyOnceWith(state.ctx, operationId);
  });
  it('uses cancellation admission instead of agreement cancellation', async () => {
    const response = await cancel(event());
    expect(await response.json()).toEqual({ status: 'cancelled' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(state.required).toHaveBeenCalledExactlyOnceWith({}, 'pos', 'create');
    expect(state.cancel).toHaveBeenCalledExactlyOnceWith(state.ctx, operationId);
    expect(state.create).not.toHaveBeenCalled();
  });
  it('returns the committed receipt when cancellation follows creation', async () => {
    state.cancel.mockResolvedValue({ status: 'committed', plan: { id: 'plan' } });
    expect(await (await cancel(event())).json()).toEqual({
      status: 'committed',
      plan: { id: 'plan' },
    });
  });
  it('preserves unknown absence and maps typed conflicts without request data', async () => {
    state.lookup.mockResolvedValue(null);
    await expect(GET(event())).rejects.toMatchObject({ status: 404 });
    state.cancel.mockRejectedValue(
      new PosError('Operation identity conflicts with an existing request.', 'operation_conflict'),
    );
    const response = await cancel(event());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Operation identity conflicts with an existing request.',
      code: 'operation_conflict',
    });
  });
  it.each([GET, cancel])(
    'denies absent identity disabled module or revoked authority before service dispatch',
    async (handler) => {
      state.ctx = null;
      await expect(handler(event())).rejects.toMatchObject({ status: 401 });
      state.ctx = {};
      state.enabled = false;
      await expect(handler(event())).rejects.toMatchObject({ status: 404 });
      state.enabled = true;
      state.required.mockRejectedValue({ status: 403 });
      await expect(handler(event())).rejects.toMatchObject({ status: 403 });
      expect(state.lookup).not.toHaveBeenCalled();
      expect(state.cancel).not.toHaveBeenCalled();
    },
  );
  it('validates operation IDs and preserves legacy POST compatibility', async () => {
    const request = (patch: object) =>
      ({
        locals: {},
        request: new Request('http://hub.test/api/pos/plans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ partyId: operationId, title: 'Plan', totalAmount: 100, ...patch }),
        }),
      }) as never;
    await expect(create(request({ operationId: 'bad' }))).rejects.toMatchObject({ status: 400 });
    expect(state.create).not.toHaveBeenCalled();
    state.create.mockResolvedValue({ id: 'plan' });
    expect((await create(request({ operationId }))).status).toBe(201);
    expect(state.create).toHaveBeenLastCalledWith(
      state.ctx,
      expect.objectContaining({ operationId }),
    );
    expect((await create(request({}))).status).toBe(201);
    expect(state.create).toHaveBeenLastCalledWith(
      state.ctx,
      expect.objectContaining({ operationId: undefined }),
    );
  });
});
