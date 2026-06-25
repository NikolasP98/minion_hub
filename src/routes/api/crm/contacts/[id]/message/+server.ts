import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { sendContactMessage } from '$server/services/crm-send.service';

/** POST /api/crm/contacts/[id]/message — send a message to the contact on a channel. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = (await request.json().catch(() => ({}))) as { channel?: string; text?: string };
  const channel = (body.channel ?? '').trim();
  const text = (body.text ?? '').trim();
  if (!channel || !text) throw error(400, 'channel and text are required');
  try {
    return json(await sendContactMessage(ctx, params.id!, channel, text));
  } catch (e) {
    throw error(502, e instanceof Error ? e.message : 'Send failed');
  }
};
