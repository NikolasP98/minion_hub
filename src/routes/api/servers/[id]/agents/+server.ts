import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listAgents, upsertAgents } from '$server/services/agent.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const agents = await listAgents(locals.tenantCtx, params.id!);
    return json({ agents });
  } catch {
    return json({ agents: [] });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const body = await request.json();
    await upsertAgents(locals.tenantCtx, params.id!, body.agents ?? []);
    return json({ ok: true });
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/agents]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
