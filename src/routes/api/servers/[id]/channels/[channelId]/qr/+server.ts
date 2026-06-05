import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getChannel, updateChannel } from '$server/services/channel.service';
import { getServerCtx } from '$server/auth/core-ctx';

export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);

  try {
    const channel = await getChannel(ctx, params.channelId!);
    if (!channel) throw error(404, 'Channel not found');
    if (channel.type !== 'whatsapp')
      throw error(400, 'QR pairing is only available for WhatsApp channels');

    await updateChannel(ctx, params.channelId!, { status: 'pairing' });

    return json({ ok: true, message: 'Channel set to pairing mode. Trigger QR via WebSocket.' });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[POST /api/servers/${params.id}/channels/${params.channelId}/qr]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
