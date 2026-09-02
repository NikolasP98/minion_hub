import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listWarehouses } from '$server/services/stock.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('stock:warehouses');
  return {
    warehouses: await listWarehouses(ctx, { includeArchived: true }),
    // ?new=1 opens the create-warehouse modal (assistant deep link).
    openNew: url.searchParams.get('new') === '1',
  };
};
