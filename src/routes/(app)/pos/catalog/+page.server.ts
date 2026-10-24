import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listSellables, listBundleEdges } from '$server/services/pos.service';
import { listItems, listAllComponentEdges } from '$server/services/stock.service';
import { billingForProducts } from '$server/services/finance-products.service';
import { costForProducts } from '$server/services/item-cost.service';
import { aggregateBundles } from './bundle-aggregates';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { getTagLinks, getProductIngredientTags } from '$server/services/tag-links.service';
import { listTags } from '$server/services/crm-contacts.service';
import { listProductCategories } from '$server/services/pos-categories.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';
import { formulaInputsFromPosRows } from '$server/services/formula-properties.service';

/** The /pos module gate + 401 live in the (app) route hook guard + this
 *  layout's auth check — this load only adds the merged catalog + (when
 *  stock is on) the item picker + recipe component graph. stockEnabled is
 *  data-bearing (controls stock
 *  ENRICHMENT below, not a route gate), so it reads the hook's per-request
 *  module-state snapshot instead of re-querying (R5).
 *
 *  Also folds in what used to be finances/products-only: billed/revenue (a
 *  billingForProducts aggregate merged by id, NOT baked into
 *  SELLABLE_MERGE_SQL, so listSellables's other callers are untouched) and
 *  cost/margin via item-cost.service's costForProducts, both field-level
 *  RBAC-masked the same way finances/products masks them. Deactivated rows
 *  always ship (spec 2026-09-29 table-toolbar: visibility is a normal
 *  `Active` filter on the table now, not a page-load param) so they stay
 *  reachable/reactivatable from the catalog instead of vanishing once
 *  toggled off. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource in +page.svelte (spec 039)
  depends('pos:catalog');

  const stockEnabled = locals.moduleStates?.stock ?? true;
  // Foreign datasets are read through their OWN handle (spec 039): the POS handle only
  // authorizes POS. Denied stock => marker slots; denied finance/crm => masked / no tags.
  const [stockCtx, financeCtx, crmCtx] = await Promise.all([
    datasetCtx(locals, 'stock'),
    datasetCtx(locals, 'finance'),
    datasetCtx(locals, 'crm'),
  ]);
  const stockOk = stockEnabled && !isDenied(stockCtx);
  const [sellables, stockItems, componentEdges, bundleEdges, maskRule, categories] =
    await Promise.all([
      listSellables(ctx, { includeInactive: true }),
      // Recipe/ingredient picker — opt OUT of archived items (spec 2026-09-28
      // Bundle F #5 followup: `listItems` default flipped to include archived).
      stockOk ? listItems(stockCtx, { includeArchived: false }) : Promise.resolve([]),
      // Recipe builder (#8): the whole org graph, so the editor can show nesting
      // and offer only children that wouldn't close a loop — both need more than
      // one item's direct children.
      stockOk ? listAllComponentEdges(stockCtx) : Promise.resolve([]),
      // Bundle (fin_product_components) edges, org-wide — feeds aggregateBundles
      // below so a package row derives Stock/Cost/Margin from its children.
      listBundleEdges(ctx),
      shouldMaskSensitive(locals, 'finance'),
      listProductCategories(ctx),
    ]);

  // Cost/margin/revenue need finance AND stock: without either view they are masked, like RBAC masking.
  const mask = maskRule || isDenied(financeCtx) || isDenied(stockCtx);
  const ids = sellables.map((s) => s.productId);
  const noTags = new Map<string, { id: string; name: string; color: string | null }[]>();
  const [billing, costs, tagsByProduct, ingredientTags, catalogTags] = await Promise.all([
    isDenied(financeCtx) ? Promise.resolve(new Map()) : billingForProducts(financeCtx, ids),
    mask || isDenied(stockCtx) ? Promise.resolve(new Map()) : costForProducts(stockCtx, ids),
    isDenied(crmCtx) ? Promise.resolve(noTags) : getTagLinks(crmCtx, 'product', ids),
    // Stock tags a product inherits from its recipe / consumed items.
    stockOk ? getProductIngredientTags(stockCtx, ids) : Promise.resolve(noTags),
    isDenied(crmCtx) ? Promise.resolve([]) : listTags(crmCtx, 'catalog'),
  ]);

  const enriched = sellables.map((s) => {
    const tags = tagsByProduct.get(s.productId) ?? [];
    const inheritedTags = ingredientTags.get(s.productId) ?? [];
    const b = billing.get(s.productId);
    const billed = b?.billed ?? 0;
    // Field-level RBAC: cost, margin AND revenue are sensitive here — omit the
    // values entirely when masked (never ship the number and hide it client-side).
    if (mask) {
      return {
        ...s,
        tags,
        inheritedTags,
        billed,
        revenue: null,
        cost: null,
        margin: null,
        marginPct: null,
        costable: false,
        partial: false,
        costMasked: true,
      };
    }
    const revenue = b?.revenue ?? 0;
    const c = costs.get(s.productId);
    const costable = c?.costable ?? false;
    const partial = c?.partial ?? false;
    const cost = costable && c ? c.cost : null;
    const margin =
      cost != null && s.unitPrice != null ? Math.round((s.unitPrice - cost) * 100) / 100 : null;
    const marginPct =
      margin != null && s.unitPrice ? Math.round((margin / s.unitPrice) * 1000) / 10 : null;
    return {
      ...s,
      tags,
      inheritedTags,
      billed,
      revenue,
      cost,
      margin,
      marginPct,
      costable,
      partial,
      costMasked: false,
    };
  });

  // Catalog tags + every inherited stock tag present — the Tags column filter options.
  const tagOptions = new Map(
    catalogTags
      .filter((t) => t.kind === 'manual')
      .map((t) => [t.id, { id: t.id, name: t.name, color: t.color }]),
  );
  for (const list of ingredientTags.values()) for (const t of list) tagOptions.set(t.id, t);
  // Masked rows already force cost/margin/stock to null for every kind — a
  // bundle aggregate would have nothing to roll up, so skip it entirely.
  const finalSellables = mask ? enriched : aggregateBundles(enriched, bundleEdges);
  // Reuse this request's canonical native price/cost/margin snapshot (now
  // including the bundle rollup) so the built-in and formula columns cannot
  // disagree because of a second cost read.
  const customProperties = await loadCustomPropertyBundle(locals, ctx, 'pos.catalog', ids, {
    formulaNativeInputs: formulaInputsFromPosRows(finalSellables, {}),
  });
  return {
    pos: {
      customProperties,
      catalogTags: catalogTags
        .filter((t) => t.kind === 'manual')
        .map((t) => ({ id: t.id, name: t.name, color: t.color })),
      tagOptions: [...tagOptions.values()],
      sellables: finalSellables,
      stockItems: isDenied(stockCtx) ? stockCtx : stockItems,
      componentEdges: isDenied(stockCtx) ? stockCtx : componentEdges,
      stockEnabled,
      categories,
    },
  };
};
