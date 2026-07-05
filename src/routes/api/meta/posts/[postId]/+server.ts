import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { decrypt } from '$server/auth/crypto';
import { igMediaDetail, fbPostAttachments, fbPostFullPicture, type FbAttachment, type FbAttachmentsResponse } from '$server/services/meta/graph-read';

/**
 * GET /api/meta/posts/[postId] — on-demand rich media for the post detail
 * page (spec 2026-07-05-socials-rename-detail-pages.md §5.3). The mirrored
 * thumbnail (meta_post_media) is a cheap preview; this resolves fresh CDN
 * urls at view time for the full carousel/video experience. Never a
 * user-facing error — any failure degrades to `{ items: [] }` (200) and the
 * page silently stays on the mirrored image.
 */

export type MediaItem = { type: 'image' | 'video'; url: string; poster?: string };

function decryptOrNull(ciphertext: string | null | undefined, iv: string | null | undefined): string | null {
  if (!ciphertext || !iv) return null;
  try {
    return decrypt(ciphertext, iv);
  } catch {
    return null;
  }
}

type PostTokenRow = {
  platform: string | null;
  page_token_ciphertext: string | null;
  page_token_iv: string | null;
  conn_token_ciphertext: string | null;
  conn_token_iv: string | null;
};

/**
 * Resolve the post's platform + a usable Graph token, reusing the same
 * asset/connection shape meta-sync.service.ts's syncPosts does: the FB page's
 * own page token for 'fb', the owning connection's token for 'ig' (the
 * IG-Login token family — see graph-read.ts's `versioned: false` IG host).
 */
async function resolvePostToken(ctx: CoreCtx, postId: string): Promise<{ platform: 'fb' | 'ig'; token: string } | null> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select mi.platform,
             a.page_token_ciphertext,
             a.page_token_iv,
             c.token_ciphertext as conn_token_ciphertext,
             c.token_iv as conn_token_iv
      from meta_post_insights mi
      join meta_assets a on a.id = mi.asset_id
      left join meta_connections c on c.id = a.connection_id
      where mi.org_id = ${ctx.tenantId} and mi.post_id = ${postId}
      limit 1
    `)) as unknown as PostTokenRow[];
    const r = rows[0];
    if (!r) return null;
    const platform: 'fb' | 'ig' = r.platform === 'ig' ? 'ig' : 'fb';
    const token =
      platform === 'fb'
        ? decryptOrNull(r.page_token_ciphertext, r.page_token_iv)
        : decryptOrNull(r.conn_token_ciphertext, r.conn_token_iv);
    if (!token) return null;
    return { platform, token };
  });
}

/** IG media node → detail-page media items. Carousel children win over the parent type; VIDEO/REELS carry a poster. Pure — unit-tested directly. */
export function mapIgMediaDetail(media: {
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  children?: { data?: Array<{ media_type?: string; media_url?: string; thumbnail_url?: string }> };
}): MediaItem[] {
  const children = media.children?.data;
  if (children && children.length > 0) {
    return children
      .filter((c) => c.media_url)
      .map((c) => (c.media_type === 'VIDEO' ? { type: 'video' as const, url: c.media_url!, poster: c.thumbnail_url } : { type: 'image' as const, url: c.media_url! }));
  }
  if (!media.media_url) return [];
  const isVideo = media.media_type === 'VIDEO' || media.media_type === 'REELS';
  return isVideo ? [{ type: 'video', url: media.media_url, poster: media.thumbnail_url }] : [{ type: 'image', url: media.media_url }];
}

function mapFbAttachment(a: FbAttachment): MediaItem | null {
  if (a.media_type === 'video' && a.media?.source) return { type: 'video', url: a.media.source, poster: a.media.image?.src };
  if (a.media?.image?.src) return { type: 'image', url: a.media.image.src };
  return null;
}

/** FB `attachments{media,subattachments}` → detail-page media items (album → one item per subattachment). Pure — unit-tested directly. */
export function mapFbAttachments(body: FbAttachmentsResponse): MediaItem[] {
  const top = body.attachments?.data ?? [];
  const items: MediaItem[] = [];
  for (const a of top) {
    const subs = a.subattachments?.data;
    const source = subs && subs.length > 0 ? subs : [a];
    for (const s of source) {
      const item = mapFbAttachment(s);
      if (item) items.push(item);
    }
  }
  return items;
}

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
