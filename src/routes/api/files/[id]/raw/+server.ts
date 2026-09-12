import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { getAuthorizedFileUrl } from '$server/services/file.service';
import { resolveAttachmentAccess } from '$server/services/attachment-access';
import { handleAttachmentError } from '../../../attachments/_errors';
import { getCoreCtx } from '$server/auth/core-ctx';

/**
 * GET /api/files/[id]/raw
 *
 * Stable, embeddable URL for a stored file (e.g. an avatar in an <img src>).
 * Resolves to a freshly-signed B2 download URL via 302 so the signed URL's
 * expiry is never baked into persisted data (avatar_url stores this route, not
 * the signed URL). Tenant-scoped — the browser sends the session cookie, so
 * locals.tenantCtx is present for same-origin image requests.
 *
 * Cache-Control on the 302 itself: the redirect is cached for an hour so the
 * browser reuses the same signed URL (and hits the object's own long-lived
 * cache) instead of re-issuing a fresh signed URL every load. expiresIn is set
 * well above the redirect's cache lifetime so a cached redirect never points
 * at an already-expired signed URL. See
 * specs/2026-07-05-meta-post-thumbnail-mirroring.md §7 (caching layers).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const access = await resolveAttachmentAccess(locals, ctx);
  try {
    const file = await getAuthorizedFileUrl(ctx, params.id!, access, 86_400);
    if (!file?.url) throw error(404);
    return new Response(null, {
      status: 302,
      headers: {
        Location: file.url,
        'Cache-Control': file.attachmentManaged ? 'private, no-store' : 'private, max-age=3600',
      },
    });
  } catch (e) {
    return handleAttachmentError(e);
  }
};
