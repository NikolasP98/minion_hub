import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionError } from '$server/services/stock-corrections.logic';

const mocks = vi.hoisted(() => ({ apply: vi.fn(), preview: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'me' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: () => Promise.resolve() }));
vi.mock('$server/services/stock-corrections.service', () => ({
  applyStockCorrection: (...args: unknown[]) => mocks.apply(...args),
  previewStockCorrection: (...args: unknown[]) => mocks.preview(...args),
}));
import { POST } from './+server';
import { POST as PREVIEW } from './preview/+server';

const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const LINE = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const full = {
  productId: NEW,
  expectedProductId: OLD,
  reason: 'wrong size',
  operationKey: KEY,
  previewHash: H1,
  payloadHash: H2,
};

function call(handler: typeof POST | typeof PREVIEW, body: unknown, lineId = LINE) {
  return handler({
    locals: {},
    params: { id: 't1', lineId },
    request: new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apply.mockResolvedValue({ schemaVersion: 1, outcome: 'applied', replayed: false });
  mocks.preview.mockResolvedValue({ eligible: true });
});

describe('POST /api/pos/tickets/:id/lines/:lineId/swap', () => {
  it('delegates to the correction engine with the line, the path ticket and the actor', async () => {
    const res = await call(POST, full);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      schemaVersion: 1,
      outcome: 'applied',
      replayed: false,
    });
    const [, command, actor, scope] = mocks.apply.mock.calls[0]!;
    expect(command).toEqual({
      request: {
        mode: 'variant_swap',
        sourceType: 'pos_ticket_line',
        sourceId: LINE,
        expectedProductId: OLD,
        replacement: { productId: NEW },
      },
      operationKey: KEY,
      previewHash: H1,
      payloadHash: H2,
      reason: 'wrong size',
    });
    expect(actor).toEqual({ id: 'me', name: null });
    expect(scope).toEqual({ ticketId: 't1' });
  });

  it('an older client without reason/key/hashes gets refresh_required and nothing is written', async () => {
    const res = await call(POST, { productId: NEW, expectedProductId: OLD });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'refresh_required', outcome: 'not_applied' });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('400s on a body without both product ids and 404s on a malformed line id', async () => {
    await expect(call(POST, { productId: NEW })).rejects.toMatchObject({ status: 400 });
    await expect(call(POST, full, 'l1')).rejects.toMatchObject({ status: 404 });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it.each([
    ['price_differs', 409],
    ['stock_drift', 409],
    ['line_changed', 409],
    ['negative_stock', 409],
    ['emitted', 409],
    ['period_locked', 423],
    ['not_found', 404],
  ])('a legacy %s refusal keeps its till code and answers %i', async (posCode, status) => {
    mocks.apply.mockRejectedValue(
      new CorrectionError('refused', 'dependent_history', undefined, posCode),
    );
    const res = await call(POST, full);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(posCode);
  });

  it('an engine refusal uses the closed correction body', async () => {
    mocks.apply.mockRejectedValue(new CorrectionError('changed', 'stale_preview'));
    const res = await call(POST, full);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'stale_preview', outcome: 'not_applied' });
  });
});

describe('POST /api/pos/tickets/:id/lines/:lineId/swap/preview', () => {
  it('previews with the reason under the path ticket', async () => {
    const res = await call(PREVIEW, { productId: NEW, expectedProductId: OLD, reason: 'r' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [, request, reason, scope] = mocks.preview.mock.calls[0]!;
    expect(request).toMatchObject({ mode: 'variant_swap', sourceId: LINE });
    expect([reason, scope]).toEqual(['r', { ticketId: 't1' }]);
  });

  it('refuses a body without a reason', async () => {
    await expect(call(PREVIEW, { productId: NEW, expectedProductId: OLD })).rejects.toMatchObject({
      status: 400,
    });
  });
});
