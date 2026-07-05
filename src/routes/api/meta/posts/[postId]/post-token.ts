import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { decrypt } from '$server/auth/crypto';

// Shared by the sibling /media and /comments endpoints (spec
// 2026-07-05-socials-rename-detail-pages.md §5.3/§5.4) — kept out of any
// +server.ts because it's not a route handler and this repo's prod build
// rejects non-handler exports from route files.

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
export async function resolvePostToken(ctx: CoreCtx, postId: string): Promise<{ platform: 'fb' | 'ig'; token: string } | null> {
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
