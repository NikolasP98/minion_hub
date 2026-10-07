import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
vi.mock('@minion-stack/cache', () => ({
  invalidateTags: vi.fn(async () => {}),
  tags: { tenantDomain: () => ['t'] },
}));
import { categoryColorsForProducts, listProducts, upsertProduct } from './finance-products.service';
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('finance-products.service', () => {
  it('listProducts selects catalog rows', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'p1', code: 'AF1', name: 'Afinamiento', billed: 380, revenue: 488038 }]);
    const rows = await listProducts(ctx(db));
    expect(rows[0].code).toBe('AF1');
  });
  it('upsertProduct inserts with onConflict and busts cache', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await upsertProduct(ctx(db), {
      code: 'AF1',
      name: 'Afinamiento',
      category: null,
      unitPrice: 100,
      active: true,
    });
    expect(db.insert).toHaveBeenCalled();
  });
});

// HC-020 — the `(org_id, name)` join already has the category NAME; keep it
// next to the colour so the calendar can subdivide by category.
describe('categoryColorsForProducts', () => {
  it('maps each product to its category name AND colour', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'p1', name: 'Laser', color: '#aa0000' },
      { id: 'p2', name: 'Facial', color: '#00aa00' },
    ]);
    const out = await categoryColorsForProducts(ctx(db), ['p1', 'p2', 'p-uncategorised']);
    expect([...out.entries()]).toEqual([
      ['p1', { name: 'Laser', color: '#aa0000' }],
      ['p2', { name: 'Facial', color: '#00aa00' }],
    ]);
    expect(out.get('p-uncategorised')).toBeUndefined();
  });
  it('answers an empty map without a query for no products', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'never', name: 'x', color: '#000000' }]);
    expect((await categoryColorsForProducts(ctx(db), [])).size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });
});
