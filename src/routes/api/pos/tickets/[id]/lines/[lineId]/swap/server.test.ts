import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosError } from '$server/services/pos/errors';

const mocks = vi.hoisted(() => ({ swap: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'me' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: () => Promise.resolve() }));
vi.mock('$server/services/pos.service', async () => ({
  swapTicketLineProduct: (...args: unknown[]) => mocks.swap(...args),
  PosError: (
    await vi.importActual<typeof import('$server/services/pos/errors')>(
      '$server/services/pos/errors',
    )
  ).PosError,
}));
import { POST } from './+server';

const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

function post(body: unknown) {
  return {
    locals: {},
    params: { id: 't1', lineId: 'l1' },
    request: new Request('http://localhost/api/pos/tickets/t1/lines/l1/swap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.swap.mockResolvedValue({ entryId: 'e2', stockWarning: null });
});

describe('POST /api/pos/tickets/:id/lines/:lineId/swap', () => {
  it('passes the ids, the body and the actor to the service', async () => {
    const res = await POST(post({ productId: NEW, expectedProductId: OLD }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, entryId: 'e2', stockWarning: null });
    expect(mocks.swap.mock.calls[0]!.slice(1)).toEqual([
      't1',
      'l1',
      { productId: NEW, expectedProductId: OLD },
      { id: 'me', name: null },
    ]);
  });

  it('400s on a body without both product ids', async () => {
    await expect(POST(post({ productId: NEW }))).rejects.toMatchObject({ status: 400 });
    expect(mocks.swap).not.toHaveBeenCalled();
  });

  it.each([
    ['price_differs', 409],
    ['stock_drift', 409],
    ['line_changed', 409],
    ['negative_stock', 409],
    ['emitted', 409],
    ['period_locked', 423],
    ['not_found', 404],
  ])('a %s refusal answers %i with its code', async (code, status) => {
    mocks.swap.mockRejectedValue(new PosError('refused', code));
    const res = await POST(post({ productId: NEW, expectedProductId: OLD }));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });
});
