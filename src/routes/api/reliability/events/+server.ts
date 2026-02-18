import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  insertReliabilityEvents,
  listReliabilityEvents,
} from '$server/services/reliability.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0) return json({ ok: true });

  await insertReliabilityEvents(locals.tenantCtx, events);
  return json({ ok: true, count: events.length });
};

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);

  const serverId = url.searchParams.get('serverId') ?? undefined;
  const category = url.searchParams.get('category') ?? undefined;
  const severity = url.searchParams.get('severity') ?? undefined;
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
  const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;

  const events = await listReliabilityEvents(locals.tenantCtx, {
    serverId,
    category,
    severity,
    from,
    to,
    limit,
    offset,
  });

  return json({ events });
};
