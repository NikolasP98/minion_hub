import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { processMetricsBatch } from '$server/services/metrics.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401, 'Unauthorized: invalid server token');

  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!serverId) throw error(401, 'Unauthorized: server identity required');

  const body = await request.json();
  const batch = body.batch;
  if (!batch || typeof batch !== 'object') {
    throw error(400, 'Missing or invalid batch payload');
  }

  await processMetricsBatch(locals.tenantCtx, batch, serverId);

  return json({ ok: true });
};
