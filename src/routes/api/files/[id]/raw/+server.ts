import type { RequestHandler } from '@sveltejs/kit';
import { redirect, error } from '@sveltejs/kit';
import { getFileUrl } from '$server/services/file.service';

/**
 * GET /api/files/[id]/raw
 *
 * Stable, embeddable URL for a stored file (e.g. an avatar in an <img src>).
 * Resolves to a freshly-signed B2 download URL via 302 so the signed URL's
 * expiry is never baked into persisted data (avatar_url stores this route, not
 * the signed URL). Tenant-scoped — the browser sends the session cookie, so
 * locals.tenantCtx is present for same-origin image requests.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  const file = await getFileUrl(locals.tenantCtx, params.id!);
  if (!file?.url) throw error(404);
  throw redirect(302, file.url);
};
