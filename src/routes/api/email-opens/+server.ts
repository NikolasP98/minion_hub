import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { markOpened } from '$server/services/email-opens.service';

/**
 * POST /api/email-opens  body: { gmailMessageId }
 * Marks a feed email opened for the signed-in user (cross-device open state).
 * Personal data — gated by auth only (the user's own opens), no org capability.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) throw error(401, 'Authentication required');
  const body = (await request.json().catch(() => ({}))) as { gmailMessageId?: unknown };
  const gmailMessageId = typeof body.gmailMessageId === 'string' ? body.gmailMessageId : '';
  if (!gmailMessageId) throw error(400, 'gmailMessageId required');
  await markOpened(locals.user.id, gmailMessageId);
  return json({ ok: true });
};
