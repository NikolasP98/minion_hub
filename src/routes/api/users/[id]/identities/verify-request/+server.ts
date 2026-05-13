import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { createOtp } from '$server/identity/otp-store';
import { gatewayCall } from '$lib/server/gateway-rpc';
import { requireAdmin } from '$server/auth/authorize';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!params.id) throw error(400);
  const isOwner = locals.user?.id === params.id;
  if (!isOwner) requireAdmin(locals);

  const b = (await request.json()) as { channel?: string; channelUserId?: string };
  if (!b.channel || !b.channelUserId) throw error(400, 'channel + channelUserId required');

  const { requestId, code } = createOtp({
    userId: params.id,
    channel: b.channel,
    channelUserId: b.channelUserId,
  });

  try {
    await gatewayCall('send', {
      to: b.channelUserId,
      channel: b.channel,
      message: `Minion identity verification code: ${code}\nValid for 10 minutes. Do not share.`,
      idempotencyKey: randomUUID(),
    });
  } catch (e) {
    throw error(502, `gateway send failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return json({ requestId });
};
