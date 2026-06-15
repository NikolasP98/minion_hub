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
 * Returns DECRYPTED credentials, so access is restricted to a valid gateway
 * server token (locals.serverId, set for this path in resolve-identity), an
 * admin session, or the user fetching their OWN id — a bare tenant-ctx is NOT
 * sufficient (any logged-in session resolves one, which would expose every
 * user's refresh token via ?userId=). Returns 404 when no linked Google identity.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const userId = url.searchParams.get('userId');
  if (!userId) throw error(400, 'userId query param required');

  const isGateway = Boolean(locals.serverId);
  if (!isGateway) {
    if (!locals.user) throw error(401, 'Authentication required');
    if (locals.user.role !== 'admin' && locals.user.id !== userId) {
      throw error(403, 'forbidden');
    }
  }

  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  try {
    const cred = await getGoogleCredential(ctx, userId);
    if (!cred) return json({ error: 'no google identity' }, { status: 404 });
    return json(cred); // { email, adc }
  } catch (e) {
    console.error('[GET /api/gateway/google-adc]', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
