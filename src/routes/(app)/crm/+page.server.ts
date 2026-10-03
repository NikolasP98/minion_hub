import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import { getCrmDashboardStats } from '$server/services/crm-contacts.service';
import { getFinSettings } from '$server/services/finance.service';
import {
  checkedZonedDayWindow,
  dateKeyAddDays,
  instantDateKey,
  parseDateKey,
} from '$lib/time/zoned';

// Date-range presets for the dashboard cohort filter (acquisition window).
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

/**
 * Resolve the dashboard's acquisition-date window from query params. Presets
 * ('7d'|'30d'|'90d'|'365d') count back from now; 'custom' reads from/to
 * (YYYY-MM-DD, inclusive); anything else ('all' / unknown) means no window.
 */
function resolveRange(
  params: URLSearchParams,
  now: Date,
  timeZone: string,
): { range: string; from: string; to: string; fromTs: number; toTs: number } {
  const range = params.get('range') ?? 'all';
  const windowFor = (from: string, to: string) => {
    const window = checkedZonedDayWindow(from, to, timeZone);
    if (!window.ok) return null;
    return {
      from,
      to,
      fromTs: window.from?.getTime() ?? -Infinity,
      // The CRM aggregate uses `<=`; convert the shared half-open end to its
      // final included millisecond. An open custom upper bound keeps the
      // previous contract of ending at invocation time, rather than reading
      // future-dated rows.
      toTs: window.to ? window.to.getTime() - 1 : now.getTime(),
    };
  };
  if (range === 'custom') {
    const rawFrom = params.get('from') ?? '';
    const rawTo = params.get('to') ?? '';
    const from = parseDateKey(rawFrom) ? rawFrom : '';
    const to = parseDateKey(rawTo) ? rawTo : '';
    const resolved = windowFor(from, to);
    if (resolved) return { range, ...resolved };
  }
  const days = RANGE_DAYS[range];
  if (days) {
    const to = instantDateKey(now, timeZone);
    // Date bounds are inclusive: a 7d preset is today plus the six preceding
    // organization dates, not eight civil dates from `today - 7` through today.
    const from = dateKeyAddDays(to, 1 - days) ?? '';
    const resolved = windowFor(from, to);
    if (resolved) return { range, ...resolved };
  }
  return { range: 'all', from: '', to: '', fromTs: -Infinity, toTs: Infinity };
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
  const settings = await getFinSettings(ctx);

  // Acquisition-date cohort filter is cheap (no DB access) — resolve it now so
  // the page shell can render the range picker immediately, without waiting
  // on the heavy roster fetch below.
  const { range, from, to, fromTs, toTs } = resolveRange(
    url.searchParams,
    new Date(),
    settings.timezone,
  );

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

  return {
    range,
    from,
    to,
    timeZone: settings.timezone,
    streamed: {
      stats: computeStats(),
    },
  };
};
