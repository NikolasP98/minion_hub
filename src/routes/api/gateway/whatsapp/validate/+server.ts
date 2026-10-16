import { json, error, type RequestHandler } from '@sveltejs/kit';
import {
  assertWhatsAppAdmission,
  whatsappString,
} from '$server/services/whatsapp-assistant.service';
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.serverId || !locals.tenantCtx) throw error(401);
  const raw = await request.text();
  if (raw.length > 1000) throw error(413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw error(400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400);
  return json({
    ok: true,
    ...(await assertWhatsAppAdmission(
      locals,
      whatsappString(body as Record<string, unknown>, 'admissionId'),
    )),
  });
};
