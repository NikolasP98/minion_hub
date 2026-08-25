import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getPerformanceSnapshot } from '$server/services/performance-monitor.service';

const DEFAULT_RANGE_MS = 24 * 60 * 60_000;
const MAX_RANGE_MS = 90 * 24 * 60 * 60_000;

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'reliability', 'view');
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId;
  if (!orgId) throw error(401, 'tenant context required');

  const now = Date.now();
  const from = Number(url.searchParams.get('from') ?? now - DEFAULT_RANGE_MS);
  const to = Number(url.searchParams.get('to') ?? now);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to <= from ||
    to - from > MAX_RANGE_MS ||
    to > now + 5 * 60_000
  ) {
    throw error(400, 'invalid performance monitor date range');
  }

  return json(await getPerformanceSnapshot(orgId, { from, to }));
};
