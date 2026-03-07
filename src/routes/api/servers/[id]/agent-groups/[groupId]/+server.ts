import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { updateGroup, deleteGroup } from '$server/services/agent-group.service';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  const body = await request.json();
  await updateGroup(locals.tenantCtx, params.id!, params.groupId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  await deleteGroup(locals.tenantCtx, params.id!, params.groupId!);
  return json({ ok: true });
};
