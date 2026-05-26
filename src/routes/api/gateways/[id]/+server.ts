import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { deleteGateway } from '$server/services/gateway.pg.service';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  await deleteGateway(params.id!);
  return json({ ok: true });
};
