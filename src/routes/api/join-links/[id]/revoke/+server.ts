import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { revokeLink } from '$server/services/join/links.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  await revokeLink(params.id!);
  return json({ ok: true });
};
