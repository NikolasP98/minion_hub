import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { adDataExtent, extentToRange, type DateRange } from '$server/services/meta/meta-insights.service';
import { adPerformance } from '$server/services/meta/ad-performance.service';

/**
 * GET /api/meta/ad-performance — Tier 1 ad/campaign performance rollup.
 * Optional ?from=&to= (ISO YYYY-MM-DD, `to` exclusive); with neither, defaults to
 * the org's full ad-data extent. Fail-closed RBAC: requires `ads:view` (the
 * codebase's read action for the ads module — the whole /socials tree gates on it).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'ads', 'view');
  const ctx = await requireCoreCtx(locals);

  const hasExplicitRange = url.searchParams.has('from') || url.searchParams.has('to');
  const defaultRange = extentToRange(await adDataExtent(ctx));
  const range: DateRange = hasExplicitRange
    ? { from: url.searchParams.get('from') || defaultRange.from, to: url.searchParams.get('to') || defaultRange.to }
    : defaultRange;

  return json(await adPerformance(ctx, range));
};
