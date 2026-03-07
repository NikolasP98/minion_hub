import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChannels, createChannel, isValidChannelType } from '$server/services/channel.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const items = await listChannels(locals.tenantCtx, params.id!);
    return json({ channels: items });
  } catch (e) {
    console.error(`[GET /api/servers/${params.id}/channels]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  try {
    const body = await request.json();
    if (!body.type || !body.label) throw error(400, 'type and label required');
    if (!isValidChannelType(body.type)) throw error(400, `Invalid channel type: ${body.type}`);

    const id = await createChannel(locals.tenantCtx, params.id!, {
      type: body.type,
      label: body.label,
      credentials: body.credentials,
      credentialsMeta: body.credentialsMeta,
      status: body.status,
    });
    return json({ ok: true, id });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[POST /api/servers/${params.id}/channels]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
