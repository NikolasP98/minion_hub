import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { computeInsights } from '$server/services/insights.service';
import { requireTenantCtx } from '$server/auth/authorize';

const DAY = 86_400_000;

/**
 * Reliability INSIGHTS — ranked, evidence-backed proposed actions derived from the
 * hub-owned `unified_events` corpus. Read-only; same auth + serverId shape as
 * /api/metrics/connection-events. One round trip returns the whole payload.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);

  const serverId = url.searchParams.get('serverId') ?? undefined;
  if (!serverId) return json({ insights: null });

  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : Date.now();
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : to - 7 * DAY;

  const insights = await computeInsights(ctx, serverId, { from, to });
  return json({ insights });
};
