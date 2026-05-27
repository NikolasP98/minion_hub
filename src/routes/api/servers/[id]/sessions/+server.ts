import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listSessions, upsertSession } from '$server/services/session.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = requireTenantCtx(locals);

  const sessions = await listSessions(ctx, params.id!);
  return json({ sessions });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = requireTenantCtx(locals);

  const body = await request.json();
  const id = await upsertSession(ctx, { ...body, serverId: params.id! });
  return json({ ok: true, id });
};
