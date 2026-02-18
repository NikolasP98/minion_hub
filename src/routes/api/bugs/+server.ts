import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { createBug, listBugs } from '$server/services/bug.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);

  const serverId = url.searchParams.get('serverId') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const severity = url.searchParams.get('severity') ?? undefined;

  const bugs = await listBugs(locals.tenantCtx, { serverId, status, severity });
  return json({ bugs });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  if (!body.serverId || !body.message) throw error(400, 'serverId and message required');

  const id = await createBug(locals.tenantCtx, body);
  return json({ ok: true, id });
};
