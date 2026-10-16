import { json, error, type RequestHandler } from '@sveltejs/kit';
import { whatsappTurn } from '$server/services/whatsapp-assistant.service';

/** Gateway-only authority; membership and shared assistant RBAC are never inferred from the bearer. */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.serverId || !locals.tenantCtx) throw error(401, 'Gateway authentication required');
  const raw = await request.text();
  if (raw.length > 20000) throw error(413, 'Request too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw error(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'Invalid body');
  return json(await whatsappTurn(locals, body as Record<string, unknown>));
};
