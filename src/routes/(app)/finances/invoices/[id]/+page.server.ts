import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getInvoice } from '$server/services/finance.service';
import { findEntryByInvoice, listWarehouses, listItems } from '$server/services/stock.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const data = await getInvoice(ctx, params.id);
  if (!data) throw error(404, 'Invoice not found');

  const stockEnabled = await isModuleEnabled(ctx, 'stock');
  const [stockEntry, stockWarehouses, stockItems] = stockEnabled
    ? await Promise.all([findEntryByInvoice(ctx, params.id), listWarehouses(ctx), listItems(ctx)])
    : [null, [], []];

  return { ...data, stockEnabled, stockEntry, stockWarehouses, stockItems };
};
