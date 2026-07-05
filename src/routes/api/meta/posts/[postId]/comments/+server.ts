import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { igMediaComments, fbPostComments } from '$server/services/meta/graph-read';
import { mapIgComments, mapFbComments, type Comment } from './comment-mapping';
import { resolvePostToken } from '../post-token';

/**
 * GET /api/meta/posts/[postId]/comments — comments panel for the post detail
 * page (spec 2026-07-05-socials-rename-detail-pages.md §5.4). Sibling of the
 * /media endpoint — same read gate + token resolution. FB comment reads are
 * expected to permission-deny (pages_read_user_content unconfirmed); IG is
 * unverified — the first live view IS the smoke test, so any denial/failure
 * degrades to `{ available: false, comments: [] }` (200), never a user-facing
 * error.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'ads', 'view');

  const postId = decodeURIComponent(params.postId ?? '');
  const headers = { 'cache-control': 'private, max-age=300' };
  try {
    const resolved = await resolvePostToken(ctx, postId);
    if (!resolved) return json({ available: false, comments: [] }, { headers });

    let comments: Comment[];
    if (resolved.platform === 'ig') {
      const res = await igMediaComments(postId, resolved.token);
      if (!res.ok || !res.data) {
        console.log('[meta/posts/comments] ig smoke test: denied/failed', { postId, error: res.error });
        return json({ available: false, comments: [] }, { headers });
      }
      comments = mapIgComments(res.data);
      console.log('[meta/posts/comments] ig smoke test: served', { postId, count: comments.length });
    } else {
      const res = await fbPostComments(postId, resolved.token, { appSecret: env.META_APP_SECRET });
      if (!res.ok || !res.data) {
        console.log('[meta/posts/comments] fb smoke test: denied (expected — pages_read_user_content)', { postId, error: res.error });
        return json({ available: false, comments: [] }, { headers });
      }
      comments = mapFbComments(res.data);
      console.log('[meta/posts/comments] fb smoke test: served', { postId, count: comments.length });
    }
    return json({ available: true, comments }, { headers });
  } catch (err) {
    console.log('[meta/posts/comments] enrichment failed, degrading to unavailable', { postId, err });
    return json({ available: false, comments: [] }, { headers });
  }
};
