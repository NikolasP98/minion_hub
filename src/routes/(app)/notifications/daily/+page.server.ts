import type { PageServerLoad } from './$types';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getDailyFeedView } from '$server/services/inbox/daily-feed.service';

/** The always-available daily feed — the knock's href lands here (and anyone
 *  can open it directly, per spec: "always readable in the inbox"). */
export const load: PageServerLoad = async ({ locals, url }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const view = await getDailyFeedView(ctx, url.searchParams.get('date') ?? undefined);
  return { view };
};
