import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getGoogleCredential } from '$server/services/identity.service';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * Decrypted credentials for a current canonical assistant principal. Gateway
 * callers supply an assigned agentId (or a signed internal admission); browser
 * callers remain self/admin and membership checked. Credentials are never cached.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  let userId: string;
  if (locals.serverId) {
    const principal = await resolveAssistantPrincipal(locals, url);
    userId = principal.principalId;
  } else {
    const requestedUser = url.searchParams.get('userId');
    if (!requestedUser) throw error(400, 'userId query param required');
    if (!locals.user) throw error(401, 'Authentication required');
    if (locals.user.role !== 'admin' && locals.user.supabaseId !== requestedUser) {
      throw error(403, 'forbidden');
    }
    const principal = await resolveAssistantPrincipal(locals, url);
    userId = principal.principalId;
  }

  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  try {
    const cred = await getGoogleCredential(ctx, userId);
    if (!cred) return json({ error: 'no google identity' }, { status: 404 });
    if (locals.whatsappAdmissionId) await resolveAssistantPrincipal(locals, url);
    return json(cred, { headers: { 'cache-control': 'no-store' } }); // { email, adc }
  } catch (e) {
    console.error('[GET /api/gateway/google-adc]', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
