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

const { GET, POST } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  getCoreCtx.mockResolvedValue({ orgId: 'org-1' });
  isModuleEnabled.mockResolvedValue(true);
  listItems.mockResolvedValue([]);
  createItem.mockResolvedValue({ id: 'item-1' });
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

describe('POST /api/stock/items', () => {
  it('drops itemGroup/reorderQty/moq — they are custom columns now, not core', async () => {
    const request = {
      json: async () => ({
        code: 'ITM-1',
        name: 'Widget',
        itemGroup: 'Sneaky',
        reorderQty: 5,
        moq: 10,
      }),
    } as Request;

    await POST!({ locals: {}, request } as never);

    expect(createItem).toHaveBeenCalledTimes(1);
    const [, payload] = createItem.mock.calls[0];
    expect(payload).not.toHaveProperty('itemGroup');
    expect(payload).not.toHaveProperty('reorderQty');
    expect(payload).not.toHaveProperty('moq');
  });
});
