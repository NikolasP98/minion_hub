import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionError } from '$server/services/stock-corrections.logic';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  status: vi.fn(),
  log: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'me' }),
}));
vi.mock('$server/services/stock-corrections.service', () => ({
  previewStockCorrection: (...a: unknown[]) => mocks.preview(...a),
  applyStockCorrection: (...a: unknown[]) => mocks.apply(...a),
  getStockCorrectionByOperationKey: (...a: unknown[]) => mocks.status(...a),
}));
vi.mock('$server/services/record-locks.service', () => ({
  logLockEvent: (...a: unknown[]) => mocks.log(...a),
  personActor: (c: { profileId?: string }, name: string | null) => ({
    kind: 'person',
    id: c.profileId ?? null,
    name,
  }),
}));
import { POST as PREVIEW } from './preview/+server';
import { POST as APPLY, GET } from './+server';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = {
  mode: 'variant_swap',
  sourceType: 'pos_ticket_line',
  sourceId: U(1),
  expectedProductId: U(2),
  replacement: { productId: U(3) },
};
const post = (handler: typeof APPLY | typeof PREVIEW, body: unknown) =>
  handler({
    locals: {},
    request: new Request('http://localhost/api/stock/corrections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);
const command = {
  request,
  operationKey: U(9),
  previewHash: 'a'.repeat(64),
  payloadHash: 'b'.repeat(64),
  reason: 'wrong size',
};

beforeEach(() => vi.clearAllMocks());

describe('stock corrections routes', () => {
  it('preview forwards request+reason and rejects unknown keys', async () => {
    mocks.preview.mockResolvedValue({ eligible: true });
    const res = await post(PREVIEW, { request, reason: 'r' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mocks.preview.mock.calls[0]!.slice(1)).toEqual([request, 'r']);
    await expect(post(PREVIEW, { request, reason: 'r', actor: 'x' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('apply passes the signed-in actor and never a client one', async () => {
    mocks.apply.mockResolvedValue({ outcome: 'applied' });
    expect((await post(APPLY, command)).status).toBe(200);
    expect(mocks.apply.mock.calls[0]![2]).toEqual({ id: 'me', name: null });
    await expect(post(APPLY, { ...command, actor: { id: 'x' } })).rejects.toMatchObject({
      status: 400,
    });
    await expect(post(APPLY, { ...command, previewHash: 'nothex' })).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });

  it('a public stock_only is refused 422 owner_evidence_required before the service runs', async () => {
    const res = await post(APPLY, { ...command, request: { mode: 'stock_only' } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'owner_evidence_required',
      outcome: 'not_applied',
    });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it.each([
    ['stale_preview', 409],
    ['price_differs', 409],
    ['stock_drift', 409],
    ['negative_stock', 409],
    ['period_locked', 422],
    ['forbidden', 403],
    ['not_found', 404],
  ] as const)('maps %s to %i with a closed body', async (code, status) => {
    mocks.apply.mockRejectedValue(new CorrectionError('nope', code));
    const res = await post(APPLY, command);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code, outcome: 'not_applied' });
  });

  it('GET reports the recorded outcome for a known key and validates the hash', async () => {
    mocks.status.mockResolvedValue({ outcome: 'not_found' });
    const url = (h: string) =>
      new URL(`http://localhost/api/stock/corrections?operationKey=${U(9)}&payloadHash=${h}`);
    const res = await GET({ locals: { user: { id: 'u' } }, url: url('b'.repeat(64)) } as never);
    expect(await res.json()).toEqual({ outcome: 'not_found' });
    await expect(
      GET({ locals: { user: { id: 'u' } }, url: url('zz') } as never),
    ).rejects.toMatchObject({ status: 400 });
    await expect(GET({ locals: {}, url: url('b'.repeat(64)) } as never)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('lock refusals (spec 140 S2)', () => {
  const receipt = {
    mode: 'receipt_replace',
    sourceType: 'stock_receipt',
    sourceId: U(5),
    replacement: {
      lines: [
        {
          originalLineId: U(6),
          itemId: U(7),
          qty: '8',
          rate: '5',
          uom: 'box',
          toWarehouseId: U(8),
        },
      ],
    },
  };
  const hit = { rule: 'days', kind: 'days', unlockable: true, days: 60 };

  it.each([
    ['record_locked', 'record is locked'],
    ['period_locked', 'period 2026-10 is locked'],
  ] as const)(
    '%s names the rules, who can unlock, and writes a refused event',
    async (code, msg) => {
      mocks.preview.mockRejectedValue(new CorrectionError(msg, code, { locks: [hit] }));
      const res = await post(PREVIEW, { request: receipt, reason: 'typo' });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        error: msg,
        code,
        outcome: 'not_applied',
        locks: [hit],
        unlockBy: 'owner',
      });
      expect(mocks.log).toHaveBeenCalledTimes(1);
      expect(mocks.log.mock.calls[0]![1]).toMatchObject({
        action: 'refused',
        recordType: 'stock_receipt',
        recordId: U(5),
        rules: [hit],
        actor: { kind: 'person', id: 'me' },
        detail: { code },
      });
      // Looped previews must not fill the append-only table.
      expect(mocks.log.mock.calls[0]![2]).toEqual({ dedupeMs: 600_000 });
    },
  );

  it('apply refusals are logged too, and a failing log never changes the refusal', async () => {
    mocks.apply.mockRejectedValue(
      new CorrectionError('record is locked', 'record_locked', { locks: [hit] }),
    );
    mocks.log.mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(APPLY, { ...command, request: receipt });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('record_locked');
    expect(mocks.log).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it('other refusals and sale swaps write no event', async () => {
    mocks.preview.mockRejectedValue(new CorrectionError('later movements', 'dependent_history'));
    await post(PREVIEW, { request: receipt, reason: 'r' });
    mocks.preview.mockRejectedValue(new CorrectionError('period locked', 'period_locked'));
    await post(PREVIEW, { request, reason: 'r' });
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
