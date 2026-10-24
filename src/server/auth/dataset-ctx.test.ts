import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCoreCtx = vi.fn();
const resolveCapabilities = vi.fn();
vi.mock('./core-ctx', () => ({ getCoreCtx: (...a: unknown[]) => getCoreCtx(...a) }));
vi.mock('$server/services/rbac.service', () => ({
  resolveCapabilities: (...a: unknown[]) => resolveCapabilities(...a),
}));

import { datasetCtx, isDenied, readDataset } from './dataset-ctx';

const ctx = { db: {}, tenantId: 't', profileId: 'p' };
const member = { user: { role: 'member', supabaseId: 'p' } } as unknown as App.Locals;

describe('datasetCtx', () => {
  beforeEach(() => {
    getCoreCtx.mockReset().mockResolvedValue(ctx);
    resolveCapabilities.mockReset();
  });

  it('rejects 401 without a tenant', async () => {
    getCoreCtx.mockResolvedValue(null);
    await expect(datasetCtx(member, 'pos')).rejects.toMatchObject({ status: 401 });
  });

  it('admin gets ctx without resolving capabilities', async () => {
    const locals = { user: { role: 'admin' } } as unknown as App.Locals;
    expect(await datasetCtx(locals, 'pos')).toBe(ctx);
    expect(resolveCapabilities).not.toHaveBeenCalled();
  });

  it('returns ctx when the role can view', async () => {
    const can = vi.fn().mockReturnValue(true);
    resolveCapabilities.mockResolvedValue({ can });
    expect(await datasetCtx(member, 'pos')).toBe(ctx);
    expect(can).toHaveBeenCalledWith('pos', 'view');
  });

  it('returns the marker when the role cannot view', async () => {
    resolveCapabilities.mockResolvedValue({ can: vi.fn().mockReturnValue(false) });
    expect(await datasetCtx(member, 'pos')).toEqual({ denied: 'pos', verb: 'view' });
  });

  it('non-admin without supabaseId is denied', async () => {
    const locals = { user: { role: 'member' } } as unknown as App.Locals;
    expect(await datasetCtx(locals, 'pos')).toEqual({ denied: 'pos', verb: 'view' });
    expect(resolveCapabilities).not.toHaveBeenCalled();
  });
});

describe('readDataset', () => {
  beforeEach(() => {
    getCoreCtx.mockReset().mockResolvedValue(ctx);
    resolveCapabilities.mockReset();
  });

  it('skips fn when denied', async () => {
    resolveCapabilities.mockResolvedValue({ can: () => false });
    const fn = vi.fn();
    expect(await readDataset(member, 'pos', fn)).toEqual({ denied: 'pos', verb: 'view' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns fn(ctx) when allowed', async () => {
    resolveCapabilities.mockResolvedValue({ can: () => true });
    const fn = vi.fn().mockResolvedValue([1]);
    expect(await readDataset(member, 'pos', fn)).toEqual([1]);
    expect(fn).toHaveBeenCalledWith(ctx);
  });
});

describe('isDenied', () => {
  it('matches only the exact marker, never a data row with a denied field', () => {
    expect(isDenied({ denied: 'pos', verb: 'view' })).toBe(true);
    expect(isDenied({ id: 1, denied: 'pos', verb: 'view' })).toBe(false);
    expect(isDenied({ denied: true })).toBe(false);
    expect(isDenied([{ denied: 'pos', verb: 'view' }])).toBe(false);
    expect(isDenied(null)).toBe(false);
  });
});
