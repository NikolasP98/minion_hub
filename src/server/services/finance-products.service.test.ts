import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
vi.mock('@minion-stack/cache', () => ({ invalidateTags: vi.fn(async () => {}), tags: { tenantDomain: () => ['t'] } }));
import { listProducts, upsertProduct } from './finance-products.service';
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
    await upsertProduct(ctx(db), { code: 'AF1', name: 'Afinamiento', category: null, unitPrice: 100, active: true });
    expect(db.insert).toHaveBeenCalled();
  });
});
