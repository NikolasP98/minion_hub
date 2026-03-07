import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { updateChannel } from '$server/services/channel.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  // Mark channel as pairing
  await updateChannel(locals.tenantCtx, params.channelId!, { status: 'pairing' });

  // The actual QR generation is handled via WebSocket to the gateway.
  // This endpoint just sets the status; the frontend triggers the WS command separately.
  return json({ ok: true, message: 'Channel set to pairing mode. Trigger QR via WebSocket.' });
};
