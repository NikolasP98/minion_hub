import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { loadPosCatalogFormData } from '$server/services/pos-catalog-form.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:catalog');

  return loadPosCatalogFormData(ctx, locals.moduleStates?.stock ?? true);
};
