import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listConsumption, listWarehouses } from '$server/services/stock.service';
import { listProducts } from '$server/services/finance-products.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');

  const [consumption, warehouses, products] = await Promise.all([
    listConsumption(ctx),
    listWarehouses(ctx),
    listProducts(ctx),
  ]);

  // Only services/products that actually consume stock are worth offering in
  // the picker — a product with no mapping yields an empty issue.
  const mappedIds = new Set(consumption.map((c) => c.finProductId));
  const services = products
    .filter((p) => mappedIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, code: p.code }));

  return { services, warehouses };
};
