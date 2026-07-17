import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  financeSummary,
  maskFinanceSummary,
  revenueSeries,
  topProducts,
  topClients,
} from '$server/services/finance.service';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { parsePeriod } from '$lib/finance/period';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await requireCoreCtx(locals);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const period = parsePeriod(url);
  // Field-level (Phase 4): hide cost/margin (discount, gross) below the finance
  // sensitive field level. RBAC gate stays synchronous.
  const maskCost = await shouldMaskSensitive(locals, 'finance');

  // Heavy body: the four aggregate queries. Streamed so the page shell paints
  // instantly with skeletons instead of blocking on this.
  async function computeData() {
    const [rawSummary, series, products, clients] = await Promise.all([
      financeSummary(ctx, period),
      revenueSeries(ctx, period),
      topProducts(ctx, period, { limit: 15 }),
      topClients(ctx, period, { limit: 10 }),
    ]);
    const summary = maskCost ? maskFinanceSummary(rawSummary) : rawSummary;
    return { summary, series, products, clients, hasData: summary.invoiceCount > 0 };
  }

  return {
    period,
    streamed: {
      data: computeData(),
    },
  };
};
