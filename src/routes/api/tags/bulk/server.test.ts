import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const isModuleEnabled = vi.fn();
const getCoreCtx = vi.fn();
const bulkAddRemoveTagLinks = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/tag-links.service', () => ({ bulkAddRemoveTagLinks }));

const { POST } = await import('./+server');

const req = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/tags/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const locals = { user: { supabaseId: 'u1' } };

beforeEach(() => {
  vi.clearAllMocks();
  getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  isModuleEnabled.mockResolvedValue(true);
  requireOrgCapability.mockResolvedValue(undefined);
  bulkAddRemoveTagLinks.mockResolvedValue(undefined);
});

describe('POST /api/tags/bulk', () => {
  it('applies add/remove for a homogeneous-kind target list', async () => {
    const res = await POST!({
      locals,
      request: req({
        scope: 'stock',
        add: ['t1'],
        remove: ['t2'],
        targets: [
          { type: 'item', id: 'i1' },
          { type: 'item', id: 'i2' },
        ],
      }),
    } as never);

    expect(res.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'stock', 'edit');
    expect(bulkAddRemoveTagLinks).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      'item',
      ['i1', 'i2'],
      ['t1'],
      ['t2'],
      'u1',
    );
  });

  it('rejects mixed entity kinds in one batch', async () => {
    await expect(
      POST!({
        locals,
        request: req({
          scope: 'stock',
          add: [],
          remove: ['t1'],
          targets: [
            { type: 'item', id: 'i1' },
            { type: 'product', id: 'p1' },
          ],
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(bulkAddRemoveTagLinks).not.toHaveBeenCalled();
  });

  it('rejects an unknown entity kind', async () => {
    await expect(
      POST!({
        locals,
        request: req({
          scope: 'crm',
          add: ['t1'],
          remove: [],
          targets: [{ type: 'contact', id: 'c1' }],
        }),
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('gates on the kind module capability before writing', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    await expect(
      POST!({
        locals,
        request: req({
          scope: 'catalog',
          add: ['t1'],
          remove: [],
          targets: [{ type: 'product', id: 'p1' }],
        }),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(bulkAddRemoveTagLinks).not.toHaveBeenCalled();
  });
});
