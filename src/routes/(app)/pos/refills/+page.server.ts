import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from '$server/services/modules.service';
import { listItems, listWarehouses, listEntries, getEntry } from '$server/services/stock.service';
import { resolveDefaultWarehouse } from '$server/services/stock-accruals.service';
import { getParty } from '$server/services/party.service';

/** View perm (`pos.refills:view`) is enforced centrally by the root layout
 *  guard (MODULE_SUBRESOURCES) — this load only fetches the tab's data. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await bothEnabled(ctx, 'pos', 'stock'))) throw error(404, 'POS or stock module disabled');
  depends('pos:refills');

  const [items, warehouses, defaultWarehouseId, recentEntries] = await Promise.all([
    listItems(ctx),
    listWarehouses(ctx),
    resolveDefaultWarehouse(ctx),
    listEntries(ctx, { type: 'receipt' }),
  ]);
  const top = recentEntries.slice(0, 10);

  // ponytail: no batched "lines for N entries" query exists — 10 getEntry
  // calls at this scale (front-desk recent list) is fine; add a joined query
  // if the recent list ever needs to grow past ~10.
  const withLines = await Promise.all(top.map((e) => getEntry(ctx, e.id)));

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const partyIds = [...new Set(top.map((e) => e.partyId).filter((x): x is string => !!x))];
  const parties = await Promise.all(partyIds.map((id) => getParty(ctx, id)));
  const partyById = new Map(parties.filter((p) => p != null).map((p) => [p.id, p]));

  const recent = top.map((e, i) => {
    const lines = withLines[i]?.lines ?? [];
    const firstItem = lines[0] ? (itemsById.get(lines[0].itemId)?.name ?? lines[0].itemId) : null;
    const totalQty = lines.reduce((s, l) => s + Number(l.qty), 0);
    const value = lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate ?? 0), 0);
    return {
      id: e.id,
      humanId: e.humanId,
      createdAt: e.createdAt,
      createdBy: e.createdBy,
      partyName: e.partyId ? (partyById.get(e.partyId)?.name ?? e.partyId) : null,
      firstItemName: firstItem,
      lineCount: lines.length,
      totalQty,
      value,
    };
  });

  return { items, warehouses, defaultWarehouseId, recent };
};
