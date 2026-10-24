import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { loadPosCatalogFormData } from '$server/services/pos-catalog-form.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource in +page.svelte (spec 039)
  depends('pos:catalog');

  return { pos: await loadPosCatalogFormData(ctx, locals.moduleStates?.stock ?? true) };
};
