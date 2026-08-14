import { describe, test, expect, vi, beforeEach } from 'vitest';

const requireOrgCapability = vi.fn<(l: unknown, m: string, a: string) => Promise<null>>();
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (l: unknown, m: string, a: string) => requireOrgCapability(l, m, a),
}));

const { requireSellableFieldCapabilities } = await import('./_owning-modules');

const LOCALS = {} as App.Locals;
const modulesAsked = () => requireOrgCapability.mock.calls.map((c) => `${c[1]}:${c[2]}`);

beforeEach(() => {
  requireOrgCapability.mockReset();
  requireOrgCapability.mockResolvedValue(null);
});

describe('sellable writes require the OWNING module, not just pos', () => {
  test('renaming the finance business key demands finance, not pos alone', async () => {
    // The bug this guards: `pos:edit` was enough to rewrite fin_products.code,
    // the key the SUSII/invoice sync resolves invoice lines through.
    await requireSellableFieldCapabilities(LOCALS, { code: 'RS-O4' }, 'edit');
    expect(modulesAsked()).toEqual(['finance:edit']);
  });

  test('editing a recipe demands stock', async () => {
    await requireSellableFieldCapabilities(
      LOCALS,
      { consumption: [{ itemId: 'i1', qtyPerUnit: 2 }] },
      'edit',
    );
    expect(modulesAsked()).toEqual(['stock:edit']);
  });

  test('a create touching both demands both, with the create action', async () => {
    await requireSellableFieldCapabilities(
      LOCALS,
      { name: 'Botox', unitPrice: 100, trackStock: true },
      'create',
    );
    expect(modulesAsked()).toEqual(['finance:create', 'stock:create']);
  });

  test('a null/false field still counts as touched — `in`, not truthiness', async () => {
    await requireSellableFieldCapabilities(LOCALS, { category: null, active: false }, 'edit');
    expect(modulesAsked()).toEqual(['finance:edit']);
  });

  test('a body touching neither asks for nothing extra (pos gate already applied)', async () => {
    await requireSellableFieldCapabilities(LOCALS, {}, 'edit');
    expect(modulesAsked()).toEqual([]);
  });

  test('a denial propagates — the guard never swallows the 403', async () => {
    requireOrgCapability.mockRejectedValueOnce(new Error('403'));
    await expect(
      requireSellableFieldCapabilities(LOCALS, { unitPrice: 1 }, 'edit'),
    ).rejects.toThrow('403');
  });
});
