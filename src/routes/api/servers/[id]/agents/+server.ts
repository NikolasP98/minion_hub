import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listAgentsForUser, upsertAgents } from '$server/services/agent.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = requireTenantCtx(locals);
  try {
    const userId = locals.user?.id;
    const userRole = locals.user?.role ?? 'user';
    const agents = await listAgentsForUser(ctx, params.id!, userId ?? '', userRole);
    return json({ agents });
  } catch {
    return json({ agents: [] });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = requireTenantCtx(locals);
  try {
    const body = await request.json();
    await upsertAgents(ctx, params.id!, body.agents ?? []);
    return json({ ok: true });
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/agents]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
