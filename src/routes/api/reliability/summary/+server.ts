import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getReliabilitySummary } from '$server/services/reliability.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);

  const serverId = url.searchParams.get('serverId') ?? undefined;
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;

  const summary = await getReliabilitySummary(locals.tenantCtx, { serverId, from, to });
  return json(summary);
};
