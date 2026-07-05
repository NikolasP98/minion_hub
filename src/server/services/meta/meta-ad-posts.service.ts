/**
 * meta_ad_posts bookkeeping — persists the ad→post link discovered by
 * graph-read.ts's `listAdsWithStoryIds` (spec
 * 2026-07-05-socials-rename-detail-pages.md §3). One row per (org, ad);
 * `post_id`/`platform` refresh on every sync. Ads with no linked post (dark
 * posts, deleted creatives) get no row — same "no row = unknown" convention
 * as meta_post_media.
 */
import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { metaAdPosts } from '$server/db/pg-meta-schema';

export type AdPostInsertRow = typeof metaAdPosts.$inferInsert;

export async function upsertAdPosts(ctx: CoreCtx, rows: AdPostInsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  await withOrgCore(ctx, async (tx) => {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await tx
        .insert(metaAdPosts)
        .values(chunk)
        .onConflictDoUpdate({
          target: [metaAdPosts.orgId, metaAdPosts.adId],
          set: {
            postId: sql`excluded.post_id`,
            platform: sql`excluded.platform`,
            updatedAt: sql`now()`,
          },
        });
    }
  });
}
