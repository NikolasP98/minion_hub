import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getChannel, updateChannel, deleteChannel } from '$server/services/channel.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  const channel = await getChannel(locals.tenantCtx, params.channelId!);
  if (!channel) throw error(404, 'Channel not found');
  return json({ channel });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  const body = await request.json();
  await updateChannel(locals.tenantCtx, params.channelId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  await deleteChannel(locals.tenantCtx, params.channelId!);
  return json({ ok: true });
};
