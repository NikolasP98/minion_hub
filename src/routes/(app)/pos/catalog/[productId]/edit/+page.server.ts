import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { loadPosCatalogFormData } from '$server/services/pos-catalog-form.service';
import { getTagLinks, getProductIngredientTags } from '$server/services/tag-links.service';

export const load: PageServerLoad = async ({ locals, depends, params }) => {
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource in +page.svelte (spec 039)
  depends('pos:catalog');

  const [stock, crm] = await Promise.all([datasetCtx(locals, 'stock'), datasetCtx(locals, 'crm')]);
  const data = await loadPosCatalogFormData(ctx, locals.moduleStates?.stock ?? true, stock, crm);
  const found = data.sellables.find((sellable) => sellable.productId === params.productId);
  if (!found) throw error(404, 'Product or service not found');

  const [tagsByProduct, ingredientTags] = await Promise.all([
    isDenied(crm)
      ? Promise.resolve(new Map<string, { id: string; name: string; color: string | null }[]>())
      : getTagLinks(crm, 'product', [found.productId]),
    data.stockEnabled && !isDenied(stock)
      ? getProductIngredientTags(stock, [found.productId])
      : Promise.resolve(new Map<string, { id: string; name: string; color: string | null }[]>()),
  ]);
  const editing = { ...found, tags: (tagsByProduct.get(found.productId) ?? []).map((t) => t.id) };

  return { pos: { ...data, editing, inheritedTags: ingredientTags.get(found.productId) ?? [] } };
};
