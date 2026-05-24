import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getGoogleCredential } from '$server/services/identity.service';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * GET /api/gateway/google-adc?userId=<id>
 *
 * On-demand: returns the DECRYPTED Google ADC blob for a single user so the
 * gateway can materialize a transient credential file for an agent turn.
 * The hub is the sole holder of ENCRYPTION_KEY; the gateway never receives
 * the key, only the per-user decrypted blob over this Bearer-authed channel.
 *
 * Protected by server token auth (Bearer token from gateway) or admin session.
 * Returns 404 when the user has no linked Google identity.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  const userId = url.searchParams.get('userId');
  if (!userId) throw error(400, 'userId query param required');

  try {
    const cred = await getGoogleCredential(ctx, userId);
    if (!cred) return json({ error: 'no google identity' }, { status: 404 });
    return json(cred); // { email, adc }
  } catch (e) {
    console.error('[GET /api/gateway/google-adc]', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
