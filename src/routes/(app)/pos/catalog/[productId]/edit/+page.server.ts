import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { loadPosCatalogFormData } from '$server/services/pos-catalog-form.service';
import { getTagLinks } from '$server/services/tag-links.service';

export const load: PageServerLoad = async ({ locals, depends, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:catalog');

  const data = await loadPosCatalogFormData(ctx, locals.moduleStates?.stock ?? true);
  const found = data.sellables.find((sellable) => sellable.productId === params.productId);
  if (!found) throw error(404, 'Product or service not found');

  const tagsByProduct = await getTagLinks(ctx, 'product', [found.productId]);
  const editing = { ...found, tags: (tagsByProduct.get(found.productId) ?? []).map((t) => t.id) };

  return { ...data, editing };
};
