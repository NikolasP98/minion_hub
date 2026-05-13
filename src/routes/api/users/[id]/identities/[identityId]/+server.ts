import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { removeIdentity } from '$server/services/identity.service';
import { requireAdmin } from '$server/auth/authorize';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!params.id || !params.identityId) throw error(400);
  const isOwner = locals.user?.id === params.id;
  if (!isOwner) requireAdmin(locals);
  await removeIdentity(locals.tenantCtx, params.identityId);
  return json({ ok: true });
};
