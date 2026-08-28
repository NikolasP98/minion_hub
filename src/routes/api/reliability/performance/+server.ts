import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getPerformanceSnapshot } from '$server/services/performance-monitor.service';

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_RANGE_MS = DAY_MS;
// The shared 90d picker is calendar-inclusive and can span slightly more than
// 90 exact 24-hour periods across DST/local-day conversion. The monitor retains
// 91 days so that supported picker contract fits without widening retention.
const MAX_RANGE_MS = 91 * DAY_MS;

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'reliability', 'view');
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId;
  if (!orgId) throw error(401, 'tenant context required');

  const now = Date.now();
  const from = Number(url.searchParams.get('from') ?? now - DEFAULT_RANGE_MS);
  const requestedTo = Number(url.searchParams.get('to') ?? now);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(requestedTo) ||
    from < 0 ||
    requestedTo <= from ||
    requestedTo - from > MAX_RANGE_MS ||
    requestedTo > now + DAY_MS
  ) {
    throw error(400, 'invalid performance monitor date range');
  }

  // Date-only controls expand today's inclusive bound to 23:59 local time.
  // There can be no samples in the future, so normalize that supported value
  // to request time instead of rejecting the whole selection.
  const to = Math.min(requestedTo, now);
  if (to <= from) throw error(400, 'invalid performance monitor date range');
  return json(await getPerformanceSnapshot(orgId, { from, to }));
};
