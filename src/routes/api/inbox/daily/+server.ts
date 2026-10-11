import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requestDailyKnock } from '$server/services/inbox/daily-feed.service';

/** POST /api/inbox/daily — idempotent per org-local day. The app shell calls
 *  this once on the caller's first open each day (client-side knock, owner
 *  decision 2026-10-10); the server dedupe key is the real guard. */
export const POST: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const result = await requestDailyKnock(ctx, m.inbox_daily_title());
  return json(result);
};
