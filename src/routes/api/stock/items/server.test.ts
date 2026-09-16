import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const getCoreCtx = vi.fn();
const isModuleEnabled = vi.fn();
const listItems = vi.fn();
const createItem = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled }));
vi.mock('$server/services/stock.service', () => ({ listItems, createItem }));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  getCoreCtx.mockResolvedValue({ orgId: 'org-1' });
  isModuleEnabled.mockResolvedValue(true);
  listItems.mockResolvedValue([]);
});

describe('GET /api/stock/items', () => {
  it('requires stock:view before returning the item catalog', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });

    const response = await GET!({ locals: { role: 'staff' } } as never);

    expect(response.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith({ role: 'staff' }, 'stock', 'view');
  });

  it('rejects a caller without stock:view before touching item data', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(GET!({ locals: {} } as never)).rejects.toMatchObject({ status: 403 });
    expect(listItems).not.toHaveBeenCalled();
  });
});
