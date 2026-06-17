import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { financeSummary, revenueSeries, topProducts, topClients } from '$server/services/finance.service';
import { parsePeriod } from '$lib/finance/period';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const period = parsePeriod(url);
  const [summary, series, products, clients] = await Promise.all([
    financeSummary(ctx, period),
    revenueSeries(ctx, period),
    topProducts(ctx, period, { limit: 15 }),
    topClients(ctx, period, { limit: 10 }),
  ]);
  return { period, summary, series, products, clients, hasData: summary.invoiceCount > 0 };
};
