import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { igMediaDetail, fbPostAttachments, fbPostFullPicture } from '$server/services/meta/graph-read';
import { mapIgMediaDetail, mapFbAttachments, type MediaItem } from './media-mapping';
import { resolvePostToken } from './post-token';

/**
 * GET /api/meta/posts/[postId] — on-demand rich media for the post detail
 * page (spec 2026-07-05-socials-rename-detail-pages.md §5.3). The mirrored
 * thumbnail (meta_post_media) is a cheap preview; this resolves fresh CDN
 * urls at view time for the full carousel/video experience. Never a
 * user-facing error — any failure degrades to `{ items: [] }` (200) and the
 * page silently stays on the mirrored image.
 */

async function resolveFbMedia(postId: string, token: string): Promise<MediaItem[]> {
  const graphOpts = { appSecret: env.META_APP_SECRET };
  try {
    const res = await fbPostAttachments(postId, token, graphOpts);
    if (res.ok && res.data) {
      const items = mapFbAttachments(res.data);
      if (items.length > 0) {
        console.log('[meta/posts/media] fb smoke test: attachments edge served', { postId });
        return items;
      }
    }
  } catch (err) {
    console.log('[meta/posts/media] fb smoke test: attachments threw, falling back', { postId, err });
  }
  const fallback = await fbPostFullPicture(postId, token, graphOpts);
  console.log('[meta/posts/media] fb smoke test: full_picture fallback served', { postId, ok: fallback.ok });
  if (fallback.ok && fallback.data?.full_picture) return [{ type: 'image', url: fallback.data.full_picture }];
  return [];
}

async function resolveIgMedia(postId: string, token: string): Promise<MediaItem[]> {
  const res = await igMediaDetail(postId, token);
  if (!res.ok || !res.data) return [];
  return mapIgMediaDetail(res.data);
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'ads', 'view');

  const postId = decodeURIComponent(params.postId ?? '');
  try {
    const resolved = await resolvePostToken(ctx, postId);
    if (!resolved) return json({ items: [] }, { headers: { 'cache-control': 'private, max-age=1800' } });
    const items = resolved.platform === 'ig' ? await resolveIgMedia(postId, resolved.token) : await resolveFbMedia(postId, resolved.token);
    return json({ items }, { headers: { 'cache-control': 'private, max-age=1800' } });
  } catch (err) {
    console.log('[meta/posts/media] enrichment failed, degrading to empty', { postId, err });
    return json({ items: [] });
  }
};
