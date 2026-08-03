import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listItems, listWarehouses } from '$server/services/stock.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const [items, warehouses] = await Promise.all([listItems(ctx), listWarehouses(ctx)]);
  return { items, warehouses };
};
