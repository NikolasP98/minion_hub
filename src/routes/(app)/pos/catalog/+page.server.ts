import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listSellables } from '$server/services/pos.service';
import { listItems, listConsumption, listAllComponentEdges } from '$server/services/stock.service';

/** The /pos module gate + 401 already live in (app)/pos/+layout.server.ts —
 *  this load only adds the merged catalog + (when stock is on) the item
 *  picker + existing consumption mappings the wizard needs for edit prefill. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:catalog');

  const stockEnabled = await isModuleEnabled(ctx, 'stock');
  const [sellables, stockItems, consumption, componentEdges] = await Promise.all([
    listSellables(ctx),
    stockEnabled ? listItems(ctx) : Promise.resolve([]),
    stockEnabled ? listConsumption(ctx) : Promise.resolve([]),
    // Recipe builder (#8): the whole org graph, so the editor can show nesting
    // and offer only children that wouldn't close a loop — both need more than
    // one item's direct children.
    stockEnabled ? listAllComponentEdges(ctx) : Promise.resolve([]),
  ]);

  return { sellables, stockItems, consumption, componentEdges, stockEnabled };
};
