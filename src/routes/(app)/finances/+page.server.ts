import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import {
  financeSummary,
  maskFinanceSummary,
  revenueSeries,
  topProducts,
  topClients,
  financeDataSpan,
  getFinSettings,
} from '$server/services/finance.service';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { parsePeriod, resolvePeriodWindow } from '$lib/finance/period';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await datasetCtx(locals, 'finance');
  if (isDenied(ctx)) return { finance: ctx }; // rendered by DataSource (spec 039)
  const finCtx = ctx; // narrowed handle for the streamed closure
  depends('finances:data');
  // A calendar day is LOCAL. Resolve the picked days to instants in the org's
  // business timezone so an evening sale isn't reported on the next day.
  const settings = await getFinSettings(ctx);
  const picked = parsePeriod(url);
  const period = resolvePeriodWindow(picked, settings.timezone);
  // Full data span (min/max invoice date) — cheap + non-streamed so the date
  // controls can show real dates for "All time".
  const dataSpan = await financeDataSpan(ctx, settings.timezone);
  // Field-level (Phase 4): hide cost/margin (discount, gross) below the finance
  // sensitive field level. RBAC gate stays synchronous.
  const maskCost = await shouldMaskSensitive(locals, 'finance');

  // Heavy body: the four aggregate queries. Streamed so the page shell paints
  // instantly with skeletons instead of blocking on this.
  async function computeData() {
    const [rawSummary, series, products, clients] = await Promise.all([
      financeSummary(finCtx, period, locals.orgKind, locals.moduleStates),
      revenueSeries(finCtx, period, locals.orgKind, locals.moduleStates),
      topProducts(finCtx, period, { limit: 15 }),
      topClients(finCtx, period, { limit: 10 }),
    ]);
    const summary = maskCost ? maskFinanceSummary(rawSummary) : rawSummary;
    return { summary, series, products, clients, hasData: summary.invoiceCount > 0 };
  }

  return {
    finance: {
      timeZone: settings.timezone,
      // The UI shows the days the user picked; the services get resolved instants.
      period: picked,
      dataSpan,
      streamed: {
        data: computeData(),
      },
    },
  };
};
