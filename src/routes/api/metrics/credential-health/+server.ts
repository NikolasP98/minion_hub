import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  insertCredentialHealthSnapshot,
  listCredentialHealthSnapshots,
} from '$server/services/credential-health.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401, 'Unauthorized');

  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!serverId) throw error(401, 'Server identity required');

  const body = await request.json();
  if (!body.snapshotJson || !body.capturedAt) {
    throw error(400, 'Missing snapshotJson or capturedAt');
  }

  await insertCredentialHealthSnapshot(locals.tenantCtx, {
    serverId,
    snapshotJson:
      typeof body.snapshotJson === 'string'
        ? body.snapshotJson
        : JSON.stringify(body.snapshotJson),
    capturedAt: body.capturedAt,
  });

  return json({ ok: true });
};

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);

  const serverId = url.searchParams.get('serverId') ?? undefined;
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;

  const snapshots = await listCredentialHealthSnapshots(locals.tenantCtx, {
    serverId,
    from,
    to,
    limit,
  });

  return json({ snapshots });
};
