import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listServers, upsertServer } from '$server/services/server.service';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const servers = await listServers(locals.tenantCtx);
    return json({ servers });
  } catch {
    return json({ servers: [] });
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const body = await request.json();
    await upsertServer(locals.tenantCtx, body);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
