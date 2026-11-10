import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import { parseAssistantPeriod } from '$server/services/assistant-period';
import { requireAssistantCapability } from '../../_shared/action-auth';
import {
  assistantProductRanking,
  type AssistantRankingMetric,
} from '$server/services/assistant-product-ranking.service';
import {
  getFinSettings,
  financeSummary,
  maskFinanceSummary,
  revenueSeries,
  topProducts,
  topClients,
} from '$server/services/finance.service';

/**
 * GET /api/gateway/query/finance?agentId=personal-<uuid>[&orgId=][&from=][&to=][&bucket=][&range=all][&metric=][&limit=]
 *
 * Finance summary, revenue/cost series and top products/clients use the shared
 * finance services with assistant-specific period parsing. Explicit from/to
 * must be real YYYY-MM-DD dates, ordered when both are present; a single bound
 * leaves the other open. range=all opens both bounds and cannot accompany dates.
 * bucket accepts day/week/month (default month); invalid explicit input is 400.
 * With no dates or range, the default is rolling 12 months in business days.
 *
 * The organization's finance timezone defines calendar days and series buckets
 * for both revenue and cost. from includes local midnight; to includes its whole
 * local day, converted to an exclusive next-midnight SQL bound (including DST).
 * Returns { period, periodSemantics, summary, series, products, clients, ranking,
 * legacyProductsSemantics }. metric is revenue (default), quantity or margin;
 * limit is 1..100 (default 15) and applies only to ranking. The requested metric
 * is ranked before limiting identifiable nonvoid, unshadowed invoice items;
 * POS-only sales are excluded and unidentified rows are disclosed separately.
 * Revenue groups keep currencies separate; coverage and boundary ties are
 * disclosed. Margin is unavailable without attributed product costs, including
 * for principals with sensitive-field access. Legacy products remains the
 * revenue-selected top 15 and cannot prove quantity or margin.
 * period contains resolved instants, while periodSemantics discloses mode,
 * timezone, calendarFrom/calendarTo and bound inclusivity. Dashboard parsing
 * and callers using the default revenueSeries timezone retain their own rules.
 *
 * Field-level masking uses the resolved `capabilities` from the trusted
 * principal (NOT `shouldMaskSensitive(locals,...)` — that helper keys off
 * `locals.user`, which is unset for gateway/server-token callers, so it would
 * silently apply the wrong default here). Masking covers summary and each
 * series bucket's opCost, discount and gross; masked buckets set sensitiveMasked.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const { ctx, capabilities } = await requireAssistantCapability(locals, url, 'finance', 'view');
  const { timezone } = await getFinSettings(ctx);
  const { period, periodSemantics } = parseAssistantPeriod(url, timezone);
  const maskCost = capabilities.fieldLevel('finance') < SENSITIVE_FIELD_LEVEL;
  const metric = url.searchParams.get('metric') ?? 'revenue';
  if (!['revenue', 'quantity', 'margin'].includes(metric))
    throw error(400, 'metric: expected revenue, quantity or margin');
  const limit = Number(url.searchParams.get('limit') ?? 15);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw error(400, 'limit: expected integer 1..100');

  const [rawSummary, series, products, clients, ranking] = await Promise.all([
    financeSummary(ctx, period),
    revenueSeries(ctx, period, undefined, undefined, { timezone }),
    topProducts(ctx, period, { limit: 15 }),
    topClients(ctx, period, { limit: 10 }),
    assistantProductRanking(ctx, period, {
      metric: metric as AssistantRankingMetric,
      limit,
      allowCost: !maskCost,
    }),
  ]);
  const summary = maskCost ? maskFinanceSummary(rawSummary) : rawSummary;
  // Match maskFinanceSummary's cost/discount/gross boundary in every bucket;
  // otherwise a caller could reconstruct hidden totals from the series.
  const visibleSeries = maskCost
    ? series.map((row) => ({
        ...row,
        opCost: null,
        discount: null,
        gross: null,
        sensitiveMasked: true,
      }))
    : series;
  return json({
    period,
    periodSemantics,
    summary,
    series: visibleSeries,
    products,
    clients,
    ranking,
    legacyProductsSemantics:
      'Revenue-selected invoice items only; use ranking for the requested metric and coverage.',
  });
};
