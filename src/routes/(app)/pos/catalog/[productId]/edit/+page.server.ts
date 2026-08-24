import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { loadPosCatalogFormData } from '$server/services/pos-catalog-form.service';

export const load: PageServerLoad = async ({ locals, depends, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:catalog');

  const data = await loadPosCatalogFormData(ctx, locals.moduleStates?.stock ?? true);
  const editing = data.sellables.find((sellable) => sellable.productId === params.productId);
  if (!editing) throw error(404, 'Product or service not found');

  return { ...data, editing };
};
