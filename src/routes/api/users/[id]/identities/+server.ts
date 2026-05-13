import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { attachIdentity, listIdentities } from '$server/services/identity.service';
import { requireAdmin } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!params.id) throw error(400, 'missing id');
  const isOwner = locals.user?.id === params.id;
  if (!isOwner) requireAdmin(locals);
  const list = await listIdentities(locals.tenantCtx, params.id);
  return json({ identities: list });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401);
  if (!params.id) throw error(400, 'missing id');
  const b = (await request.json()) as { channel?: string; channelUserId?: string; displayName?: string };
  if (!b.channel || !b.channelUserId) throw error(400, 'channel + channelUserId required');
  try {
    const id = await attachIdentity(locals.tenantCtx, params.id, {
      channel: b.channel,
      channelUserId: b.channelUserId,
      displayName: b.displayName,
      verified: true,
    });
    return json({ ok: true, id });
  } catch (e) {
    if (/UNIQUE|duplicate/i.test(String(e))) throw error(409, 'identity already linked');
    throw error(500, String(e));
  }
};
