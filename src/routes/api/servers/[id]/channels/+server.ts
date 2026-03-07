import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChannels, createChannel } from '$server/services/channel.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  const items = await listChannels(locals.tenantCtx, params.id!);
  return json({ channels: items });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  if (!body.type || !body.label) throw error(400, 'type and label required');

  const id = await createChannel(locals.tenantCtx, params.id!, {
    type: body.type,
    label: body.label,
    credentials: body.credentials,
    credentialsMeta: body.credentialsMeta,
    status: body.status,
  });
  return json({ ok: true, id });
};
