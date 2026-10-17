import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleWriteError } from '$server/services/errors';
const mocks = vi.hoisted(() => ({ updateItem: vi.fn(), getCoreCtx: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/stock.service', () => ({
  updateItem: mocks.updateItem,
  StockError: class extends Error {},
}));
import { PATCH } from './+server';
const token = '2026-10-16T00:00:00.000Z';
const call = (body: Record<string, unknown>) =>
  PATCH({
    locals: {},
    params: { id: 'item' },
    request: new Request('http://localhost/api/stock/items/item', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org' });
});
describe('stock item version admission', () => {
  it('rejects missing and malformed expectations before mutation', async () => {
    for (const body of [{ name: 'New' }, { name: 'New', expectedUpdatedAt: 'bad' }])
      await expect(call(body)).rejects.toMatchObject({ status: 400 });
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });
  it('passes the expected token separately and returns the authoritative row', async () => {
    const item = { id: 'item', updatedAt: '2026-10-16T00:00:00.001Z' };
    mocks.updateItem.mockResolvedValue(item);
    const response = await call({ name: 'New', expectedUpdatedAt: token });
    expect(await response.json()).toEqual(item);
    expect(mocks.updateItem).toHaveBeenCalledWith(
      { tenantId: 'org' },
      'item',
      expect.not.objectContaining({ expectedUpdatedAt: expect.anything() }),
      new Date(token),
    );
  });
  it('returns conflict with current row and preserves missing404', async () => {
    mocks.updateItem.mockRejectedValueOnce(new StaleWriteError({ id: 'item', name: 'Other' }));
    const response = await call({ name: 'New', expectedUpdatedAt: token });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'stale', current: { name: 'Other' } });
    mocks.updateItem.mockResolvedValueOnce(null);
    await expect(call({ name: 'New', expectedUpdatedAt: token })).rejects.toMatchObject({
      status: 404,
    });
  });
});
