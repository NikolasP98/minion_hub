import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const getCoreCtx = vi.fn();
const isModuleEnabled = vi.fn();
const getBins = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled }));
vi.mock('$server/services/stock.service', () => ({ getBins }));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  getCoreCtx.mockResolvedValue({ orgId: 'org-1' });
  isModuleEnabled.mockResolvedValue(true);
  getBins.mockResolvedValue([]);
});

describe('GET /api/stock/bins', () => {
  it('requires stock:view before returning bin levels', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });

    const response = await GET!({
      locals: { role: 'viewer' },
      url: new URL('http://localhost/api/stock/bins'),
    } as never);

    expect(response.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith({ role: 'viewer' }, 'stock', 'view');
  });

  it('rejects a caller without stock:view before touching bin data', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(
      GET!({ locals: {}, url: new URL('http://localhost/api/stock/bins') } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(getBins).not.toHaveBeenCalled();
  });
});
