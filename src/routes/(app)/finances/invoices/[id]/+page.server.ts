import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getInvoice } from '$server/services/finance.service';
import { findEntryByInvoice, listWarehouses, listItems } from '$server/services/stock.service';
import { listBookingsForInvoice } from '$server/services/scheduling-bookings.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await datasetCtx(locals, 'finance');
  if (isDenied(ctx)) return { finance: ctx }; // rendered by DataSource (spec 039)
  depends('finances:data');
  const data = await getInvoice(ctx, params.id);
  if (!data) throw error(404, 'Invoice not found');

  // Data-bearing, not a route gate: shapes the returned stock payload below.
  // Reads the hook's per-request module-state snapshot instead of
  // re-querying (routing-simplification spec R5).
  const stockEnabled = locals.moduleStates?.stock ?? true;
  const schedulingEnabled = locals.moduleStates?.scheduling ?? true;
  // Stock + scheduling slices are THEIR datasets: own handles; denied => empty slice (spec 039).
  const stk = await datasetCtx(locals, 'stock');
  const sched = await datasetCtx(locals, 'scheduling');
  const readStock = stockEnabled && !isDenied(stk);
  const readSched = schedulingEnabled && !isDenied(sched);
  const [stockEntry, stockWarehouses, stockItems, bookings, customProperties] = await Promise.all([
    readStock ? findEntryByInvoice(stk, params.id) : Promise.resolve(null),
    readStock ? listWarehouses(stk) : Promise.resolve([]),
    // includeArchived: true — this resolves item labels for an EXISTING
    // (historical) stock entry linked to the invoice; an archived item must
    // still show its name here (spec 2026-09-28 Bundle C #5).
    readStock ? listItems(stk, { includeArchived: true }) : Promise.resolve([]),
    readSched ? listBookingsForInvoice(sched, params.id) : Promise.resolve([]),
    // Overview card custom properties (spec 2026-09-28 Bundle F).
    loadCustomPropertyBundle(locals, ctx, 'finances.invoices', [params.id]),
  ]);

  return {
    finance: {
      ...data,
      stockEnabled,
      stockEntry,
      stockWarehouses,
      stockItems,
      bookings,
      customProperties,
    },
  };
};
