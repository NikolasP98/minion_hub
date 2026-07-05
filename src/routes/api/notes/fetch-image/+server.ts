import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { FetchImageError, fetchImageSafely, SsrfBlockedError } from '$server/services/ssrf-guard';
import { uploadFile } from '$server/services/file.service';

/**
 * POST /api/notes/fetch-image  { url }
 *
 * Re-hosts a remote image URL: SSRF-validates the host (and every redirect hop),
 * fetches the bytes, and stores them in B2 via the existing file service. Returns
 * the stable `fileId` so the note references our copy (rendered through
 * /api/files/<fileId>/raw) — not the third-party URL.
 *
 * Dimensions are measured client-side after load, so we don't pull an image lib
 * in just for width/height (returns w/h = 0).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url || typeof url !== 'string') throw error(400, 'url is required');

  let fetched: { data: Uint8Array; contentType: string; fileName: string };
  try {
    fetched = await fetchImageSafely(url);
  } catch (e) {
    if (e instanceof SsrfBlockedError) throw error(400, 'That URL is not allowed.');
    if (e instanceof FetchImageError) throw error(e.status, e.message);
    throw error(502, 'Could not fetch that image.');
  }

  const fileId = await uploadFile(ctx, {
    fileName: fetched.fileName,
    contentType: fetched.contentType,
    data: fetched.data,
    category: 'notes',
    uploadedBy: locals.user?.supabaseId,
  });

  return json({ fileId, w: 0, h: 0 });
};
