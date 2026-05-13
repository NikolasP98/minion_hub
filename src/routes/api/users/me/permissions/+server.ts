import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getPermissionsForUser } from '$server/services/roles.service';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.tenantCtx || !locals.user) throw error(401);
  const perms = await getPermissionsForUser(locals.tenantCtx, locals.user.id);
  return json({ permissions: [...perms] });
};
