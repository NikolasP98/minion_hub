import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getTenant, updateTenant } from '$server/services/tenant.service';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.tenantCtx) throw error(401);

  const tenant = await getTenant(locals.tenantCtx);
  if (!tenant) throw error(404);
  return json({ tenant });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  await updateTenant(locals.tenantCtx, body);
  return json({ ok: true });
};
