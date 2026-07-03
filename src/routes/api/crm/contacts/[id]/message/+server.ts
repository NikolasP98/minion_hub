import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { sendContactMessage } from '$server/services/crm-send.service';

const postSchema = z.object({
  channel: z.string().max(200).optional(),
  text: z.string().max(20_000).optional(),
  clientId: z.string().max(200).optional(),
});

/** POST /api/crm/contacts/[id]/message — send a message to the contact on a channel. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const channel = (body.channel ?? '').trim();
  const text = (body.text ?? '').trim();
  const clientId = body.clientId?.trim() || undefined;
  if (!channel || !text) throw error(400, 'channel and text are required');
  try {
    return json(await sendContactMessage(ctx, params.id!, channel, text, clientId));
  } catch (e) {
    throw error(502, e instanceof Error ? e.message : 'Send failed');
  }
};
