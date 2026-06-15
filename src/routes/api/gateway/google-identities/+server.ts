import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { resolveFeedGoogleCredentials } from '$server/services/shared-identity.service';

/**
 * GET /api/gateway/google-identities?userId=<id>
 *
 * Returns ALL Google ADC blobs the user's feed should pull: their own identity
 * plus every shared identity they hold an active subscription to. The hub is
 * the sole holder of ENCRYPTION_KEY and the authority on subscriptions, so this
 * is the pull-time authorization point — a shared identity appears only while
 * `shareable=true` and the subscription exists.
 *
 * Bearer server-token (gateway) or admin session. Always 200 with a (possibly
 * empty) `identities` array — never 404 (so the gateway can distinguish a
 * missing route on an older hub from "no identities").
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const userId = url.searchParams.get('userId');
  if (!userId) throw error(400, 'userId query param required');

  try {
    const identities = await resolveFeedGoogleCredentials(ctx, userId);
    return json({ identities }); // [{ email, adc, shared, ownerName? }]
  } catch (e) {
    console.error('[GET /api/gateway/google-identities]', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
