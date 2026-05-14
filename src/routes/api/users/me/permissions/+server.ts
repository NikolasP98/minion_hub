import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { loadPermissionsForUser } from '$server/services/permissions.service';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.tenantCtx || !locals.user) throw error(401);
  return json(await loadPermissionsForUser(locals, locals.user.id));
};
