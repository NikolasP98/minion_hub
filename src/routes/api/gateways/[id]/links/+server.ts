import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { linkGatewayToUser, unlinkGatewayFromUser } from '$server/services/gateway.pg.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const b = (await request.json().catch(() => ({}))) as { profileId?: string };
  if (!b.profileId) throw error(400, 'profileId required');
  await linkGatewayToUser(b.profileId, params.id!);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const b = (await request.json().catch(() => ({}))) as { profileId?: string };
  if (!b.profileId) throw error(400, 'profileId required');
  await unlinkGatewayFromUser(b.profileId, params.id!);
  return json({ ok: true });
};
