import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { unsubscribeFromIdentity } from '$server/services/shared-identity.service';

/** DELETE /api/shared-identities/:identityId → unsubscribe the current user. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  if (!params.identityId) throw error(400, 'missing identityId');
  await unsubscribeFromIdentity(user.id, params.identityId);
  return json({ ok: true });
};
