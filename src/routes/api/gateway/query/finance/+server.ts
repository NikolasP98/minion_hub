import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import { parseAssistantPeriod } from '$server/services/assistant-period';
import { requireAssistantCapability } from '../../_shared/action-auth';
import {
  getFinSettings,
  financeSummary,
  maskFinanceSummary,
  revenueSeries,
  topProducts,
  topClients,
} from '$server/services/finance.service';

/**
 * GET /api/gateway/query/finance?agentId=personal-<uuid>[&orgId=][&from=][&to=][&bucket=][&range=all]
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
 * Returns { period, periodSemantics, summary, series, products, clients };
 * period contains resolved instants, while periodSemantics discloses mode,
 * timezone, calendarFrom/calendarTo and bound inclusivity. Dashboard parsing
 * and callers using the default revenueSeries timezone retain their own rules.
 *
 * Field-level masking uses the resolved `capabilities` from the trusted
 * principal (NOT `shouldMaskSensitive(locals,...)` — that helper keys off
 * `locals.user`, which is unset for gateway/server-token callers, so it would
 * silently apply the wrong default here).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const { ctx, capabilities } = await requireAssistantCapability(locals, url, 'finance', 'view');
  const { timezone } = await getFinSettings(ctx);
  const { period, periodSemantics } = parseAssistantPeriod(url, timezone);
  const maskCost = capabilities.fieldLevel('finance') < SENSITIVE_FIELD_LEVEL;

  const [rawSummary, series, products, clients] = await Promise.all([
    financeSummary(ctx, period),
    revenueSeries(ctx, period, undefined, undefined, { timezone }),
    topProducts(ctx, period, { limit: 15 }),
    topClients(ctx, period, { limit: 10 }),
  ]);
  const summary = maskCost ? maskFinanceSummary(rawSummary) : rawSummary;
  return json({ period, periodSemantics, summary, series, products, clients });
};
