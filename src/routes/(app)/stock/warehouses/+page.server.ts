import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listWarehouses } from '$server/services/stock.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await datasetCtx(locals, 'stock');
  if (isDenied(ctx)) return { stock: ctx }; // rendered by DataSource (spec 039)
  depends('stock:warehouses');
  return {
    stock: {
      warehouses: await listWarehouses(ctx, { includeArchived: true }),
      // ?new=1 opens the create-warehouse modal (assistant deep link).
      openNew: url.searchParams.get('new') === '1',
    },
  };
};
