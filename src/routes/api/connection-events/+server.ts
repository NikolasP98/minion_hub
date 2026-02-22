import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { insertConnectionEvent } from '$server/services/connection.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const body = await request.json();
    await insertConnectionEvent(locals.tenantCtx, body);
    return json({ ok: true });
  } catch (e) {
    console.error('[POST /api/connection-events]', e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
