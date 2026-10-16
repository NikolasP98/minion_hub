import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getCoreCtx: vi.fn(),
  setDefaultLayout: vi.fn(),
  getDefaultLayout: vi.fn(),
}));
vi.mock('$server/auth/authorize', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/dashboard-layouts.service', () => ({
  setDefaultLayout: mocks.setDefaultLayout,
  getDefaultLayout: mocks.getDefaultLayout,
}));
import { PUT } from './+server';
const put = (value: unknown) =>
  PUT({
    locals: {},
    params: { id: 'dashboard' },
    request: new Request('http://localhost/api/dashboard-layouts/dashboard', {
      method: 'PUT',
      body: JSON.stringify(value),
    }),
  } as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-a' });
  mocks.setDefaultLayout.mockResolvedValue(undefined);
});
describe('dashboard layout validation', () => {
  it('rejects malformed and unbounded spans before any write', async () => {
    for (const value of [
      { order: ['a'], span: { a: { w: 'oops', h: 2 } } },
      { order: ['a', 'a'], span: {} },
      { version: 5, order: [], span: {} },
      { order: ['a'], span: { a: { w: 25, h: 1 } } },
    ]) {
      expect((await put(value)).status).toBe(400);
    }
    expect(mocks.setDefaultLayout).not.toHaveBeenCalled();
  });
  it('accepts current hidden cards and preserves the existing admin gate', async () => {
    const layout = { version: 1, order: ['a'], span: { a: { w: 2, h: 1 } }, hidden: ['a'] };
    expect((await put(layout)).status).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.setDefaultLayout).toHaveBeenCalledWith({ tenantId: 'org-a' }, 'dashboard', layout);
  });
});
