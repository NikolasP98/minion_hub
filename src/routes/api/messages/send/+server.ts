import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { sendConversationMessage } from '$server/services/crm-send.service';

const postSchema = z.object({
  channel: z.string().min(1).max(200),
  chatId: z.string().min(1).max(500),
  text: z.string().min(1).max(20_000),
  clientId: z.string().max(200).optional(),
});

/**
 * POST /api/messages/send — reply into an existing conversation (omnichat dock).
 * Write-gated centrally via API_WRITE_PREFIXES ('/api/messages' → crm).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  try {
    return json(
      await sendConversationMessage(ctx, {
        channel: body.channel.trim(),
        chatId: body.chatId.trim(),
        text: body.text,
        clientId: body.clientId?.trim() || undefined,
      }),
    );
  } catch (e) {
    throw error(502, e instanceof Error ? e.message : 'Send failed');
  }
};
