import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getBug, updateBugStatus } from '$server/services/bug.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const bug = await getBug(locals.tenantCtx, params.id!);
  if (!bug) throw error(404);
  return json({ bug });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const { status } = await request.json();
  if (!status) throw error(400, 'status required');

  await updateBugStatus(locals.tenantCtx, params.id!, status);
  return json({ ok: true });
};
