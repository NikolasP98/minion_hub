import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { getCrmDashboardStats } from '$server/services/crm-contacts.service';
import { fromTimestamps, toTimestamps } from '$lib/components/dashboard/date-range/url';

// Date-range presets for the dashboard cohort filter (acquisition window).
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the dashboard's acquisition-date window from query params. Presets
 * ('7d'|'30d'|'90d'|'365d') count back from now; 'custom' reads from/to
 * (YYYY-MM-DD, inclusive); anything else ('all' / unknown) means no window.
 */
function resolveRange(
  params: URLSearchParams,
  now: number,
): { range: string; fromTs: number; toTs: number } {
  const range = params.get('range') ?? 'all';
  if (range === 'custom') {
    const from = params.get('from');
    const to = params.get('to');
    // Bounds come from the shared adapter so the `to` day is whole (…T23:59:59.999);
    // a hand-rolled T23:59:59 silently dropped that final second's records.
    const { fromTs, toTs } = toTimestamps({ from: from ?? '', to: to ?? '' });
    return {
      range,
      fromTs: Number.isFinite(fromTs) ? fromTs : -Infinity,
      toTs: Number.isFinite(toTs) ? toTs : now,
    };
  }
  const days = RANGE_DAYS[range];
  if (days) return { range, fromTs: now - days * DAY_MS, toTs: now };
  return { range: 'all', fromTs: -Infinity, toTs: Infinity };
}

export const load: PageServerLoad = async ({ locals, url, depends, parent }) => {
  const ctx = await requireCoreCtx(locals);
  depends('crm:contacts');
  // Personal orgs de-emphasize the sales funnel (WP2) — skip computing the
  // funnel/revenue payloads the dashboard won't render for them.
  const { activeOrgKind } = await parent();
  const isPersonal = activeOrgKind === 'personal';

  // Record-level RBAC stays synchronous. The aggregate returns no contact PII,
  // so field masking is irrelevant and no second authz read is needed.
  const owner = await ownerFilter(locals, 'crm');

  // Acquisition-date cohort filter is cheap (no DB access) — resolve it now so
  // the page shell can render the range picker immediately, without waiting
  // on the heavy roster fetch below.
  const { range, fromTs, toTs } = resolveRange(url.searchParams, Date.now());

  // The streamed body is one cached SQL aggregate. It preserves the roster's
  // score/lifecycle/funnel semantics without materializing 17k+ contacts in the
  // server process before the compact dashboard payload can close.
  async function computeStats() {
    const bounded =
      range === 'all'
        ? {}
        : {
            from: Number.isFinite(fromTs) ? new Date(fromTs) : new Date('1970-01-01T00:00:00Z'),
            to: Number.isFinite(toTs) ? new Date(toTs) : new Date(),
          };
    return getCrmDashboardStats(ctx, {
      ownerId: owner ?? undefined,
      ...bounded,
      includeRevenue: !isPersonal,
    });
  }

  // Expose the resolved window as dates so the shared date controls can show it.
  const window = fromTimestamps(fromTs, toTs);

  return {
    range,
    from: window.from,
    to: window.to,
    streamed: {
      stats: computeStats(),
    },
  };
};
