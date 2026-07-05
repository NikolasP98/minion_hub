/**
 * Meta post-thumbnail mirror bookkeeping (spec
 * 2026-07-05-meta-post-thumbnail-mirroring.md §4, §6, WP3). One row per post
 * in `meta_post_media` (org_id, platform, post_id) tracks the mirror
 * lifecycle: pending → mirrored | failed | skipped. The actual network fetch
 * + blob upload lives in meta-sync.service.ts's mirror pass — this file is
 * just the org-scoped CRUD over the table, same withOrgCore convention as
 * every other meta service.
 */
import { and, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { metaPostMedia, type MetaPostMedia } from '$server/db/pg-meta-schema';

/** A failed row is retried until it has failed this many times. */
export const MAX_MIRROR_ATTEMPTS = 5;

export type RecordPostMediaInput = {
  orgId: string;
  platform: 'fb' | 'ig';
  postId: string;
  /** Meta's CDN preview url for this post (expires — never re-served, only mirrored). Null = no usable preview (text-only post). */
  sourceUrl: string | null;
  mediaType: string | null;
};

/** A post with no usable preview url (text-only) records as `skipped`, never `pending`. Pure — unit-tested directly. */
export function pendingStatus(sourceUrl: string | null): 'pending' | 'skipped' {
  return sourceUrl ? 'pending' : 'skipped';
}

/**
 * Upsert-pending: always refreshes `source_url` (Meta's CDN links expire, so
 * a fresh sync must overwrite a stale one even on an already-`failed` row —
 * that's what makes a failed mirror self-healing on the next posts sync) but
 * never downgrades a row that's already `mirrored` back to `pending` — the
 * blob we already mirrored stays valid regardless of what the Graph API
 * returns for the url on a later sync.
 */
export async function recordPostMedia(ctx: CoreCtx, input: RecordPostMediaInput): Promise<void> {
  const status = pendingStatus(input.sourceUrl);
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(metaPostMedia)
      .values({
        orgId: input.orgId,
        platform: input.platform,
        postId: input.postId,
        sourceUrl: input.sourceUrl,
        mediaType: input.mediaType,
        status,
      })
      .onConflictDoUpdate({
        target: [metaPostMedia.orgId, metaPostMedia.platform, metaPostMedia.postId],
        set: {
          sourceUrl: sql`excluded.source_url`,
          mediaType: sql`excluded.media_type`,
          status: sql`case when ${metaPostMedia.status} = 'mirrored' then ${metaPostMedia.status} else excluded.status end`,
          updatedAt: sql`now()`,
        },
      }),
  );
}

/** Up to `limit` rows still needing a mirror attempt: pending, or failed with attempts left. */
export async function claimPendingMedia(ctx: CoreCtx, orgId: string, limit: number): Promise<MetaPostMedia[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(metaPostMedia)
      .where(
        and(
          eq(metaPostMedia.orgId, orgId),
          sql`(${metaPostMedia.status} = 'pending' or (${metaPostMedia.status} = 'failed' and ${metaPostMedia.attempts} < ${MAX_MIRROR_ATTEMPTS}))`,
        ),
      )
      .orderBy(metaPostMedia.createdAt)
      .limit(limit),
  );
}

export async function markMirrored(
  ctx: CoreCtx,
  orgId: string,
  platform: string,
  postId: string,
  fileId: string,
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(metaPostMedia)
      .set({ status: 'mirrored', fileId, error: null, fetchedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(metaPostMedia.orgId, orgId), eq(metaPostMedia.platform, platform), eq(metaPostMedia.postId, postId))),
  );
}

/** Strip query strings (Meta CDN urls carry signature/token params) and cap length before persisting. Pure — unit-tested directly. */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\?\S+/g, '?[redacted]').slice(0, 300);
}

export async function markFailed(
  ctx: CoreCtx,
  orgId: string,
  platform: string,
  postId: string,
  error: unknown,
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(metaPostMedia)
      .set({ status: 'failed', error: sanitizeError(error), attempts: sql`${metaPostMedia.attempts} + 1`, updatedAt: sql`now()` })
      .where(and(eq(metaPostMedia.orgId, orgId), eq(metaPostMedia.platform, platform), eq(metaPostMedia.postId, postId))),
  );
}
