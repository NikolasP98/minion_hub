import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getInvoice } from '$server/services/finance.service';
import { findEntryByInvoice, listWarehouses, listItems } from '$server/services/stock.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('finances:data');
  const data = await getInvoice(ctx, params.id);
  if (!data) throw error(404, 'Invoice not found');

  // Data-bearing, not a route gate: shapes the returned stock payload below.
  // Reads the hook's per-request module-state snapshot instead of
  // re-querying (routing-simplification spec R5).
  const stockEnabled = locals.moduleStates?.stock ?? true;
  const [stockEntry, stockWarehouses, stockItems] = stockEnabled
    ? await Promise.all([findEntryByInvoice(ctx, params.id), listWarehouses(ctx), listItems(ctx)])
    : [null, [], []];

  return { ...data, stockEnabled, stockEntry, stockWarehouses, stockItems };
};
