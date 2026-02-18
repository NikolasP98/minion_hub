import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');

  return json({
    user: locals.user,
    tenantId: locals.tenantCtx?.tenantId ?? null,
    role: locals.role ?? null,
  });
};
