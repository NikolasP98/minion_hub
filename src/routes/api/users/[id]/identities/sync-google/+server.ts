import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { syncGoogleIdentityFromAccount } from '$server/services/identity.service';
import { requireAdmin } from '$server/auth/authorize';

/**
 * POST /api/users/[id]/identities/sync-google
 *
 * Mirrors the user's Better Auth Google account into user_identities (encrypted
 * ADC). Called by the profile page right after a successful linkSocial. Owner
 * or admin only. 404 when the user has no linked Google account.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!params.id) throw error(400, 'missing id');
  const isOwner = locals.user?.id === params.id;
  if (!isOwner) requireAdmin(locals);

  const result = await syncGoogleIdentityFromAccount(locals.tenantCtx, params.id);
  if (!result) return json({ error: 'no google account linked' }, { status: 404 });
  return json({ ok: true, email: result.email });
};
