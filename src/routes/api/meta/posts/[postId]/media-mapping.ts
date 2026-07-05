import type { FbAttachment, FbAttachmentsResponse } from '$server/services/meta/graph-read';

// Pure Graph-response → media-item mappers for the post-media endpoint.
// Live in a sibling module (not +server.ts) because SvelteKit's production
// build rejects non-handler exports from route files.

export type MediaItem = { type: 'image' | 'video'; url: string; poster?: string };

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
