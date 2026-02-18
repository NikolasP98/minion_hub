import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listUsers, createContactUser } from '$server/services/user.service';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.tenantCtx) throw error(401);

  const users = await listUsers(locals.tenantCtx);
  return json({ users });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  if (!body.email || !body.password) throw error(400, 'email and password required');

  const id = await createContactUser(locals.tenantCtx, body);
  return json({ ok: true, id });
};
