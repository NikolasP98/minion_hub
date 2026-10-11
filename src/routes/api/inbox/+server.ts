import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listFeed } from '$server/services/inbox/inbox.service';

/** GET /api/inbox — the scope-resolved feed (`/notifications` page).
 *  Query: `kinds` (comma-separated), `includeResolved` ('1'), `limit`, `cursor`. */
export const GET: RequestHandler = async ({ locals, url }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const kindsParam = url.searchParams.get('kinds');
  const result = await listFeed(ctx, {
    kinds: kindsParam ? kindsParam.split(',').filter(Boolean) : undefined,
    includeResolved: url.searchParams.get('includeResolved') === '1',
    limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  return json(result);
};
