import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { upsertServer, deleteServer } from '$server/services/server.service';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const body = await request.json();
    const id = params.id!;
    await upsertServer(locals.tenantCtx, { id, name: '', url: '', token: '', ...body });
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    await deleteServer(locals.tenantCtx, params.id!);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
