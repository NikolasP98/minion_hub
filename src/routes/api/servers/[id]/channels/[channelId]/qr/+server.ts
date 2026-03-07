import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getChannel, updateChannel } from '$server/services/channel.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  try {
    const channel = await getChannel(locals.tenantCtx, params.channelId!, params.id!);
    if (!channel) throw error(404, 'Channel not found');
    if (channel.type !== 'whatsapp') throw error(400, 'QR pairing is only available for WhatsApp channels');

    await updateChannel(locals.tenantCtx, params.channelId!, { status: 'pairing' }, params.id!);

    return json({ ok: true, message: 'Channel set to pairing mode. Trigger QR via WebSocket.' });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[POST /api/servers/${params.id}/channels/${params.channelId}/qr]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
