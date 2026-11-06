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
 * GET /api/gateway/query/finance?agentId=personal-<uuid>[&orgId=][&from=][&to=][&bucket=]
 *
 * Invoices/payments summary + date-range revenue series + top products/clients —
 * the same service calls as /finances +page.server.ts, reused verbatim.
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
