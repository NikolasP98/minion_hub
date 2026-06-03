import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  insertMessages,
  applyRoutingPatches,
  type IngestRow,
  type RoutingPatch,
} from '$server/services/messages.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  // Authenticated via Bearer server token (resolveViaMetricsBearer sets tenantCtx + serverId).
  if (!locals.tenantCtx) throw error(401, 'Unauthorized');
  const orgId = locals.tenantCtx.tenantId;
  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;

  const body = (await request.json()) as { rows?: IngestRow[]; patches?: RoutingPatch[] };
  const rows = (Array.isArray(body.rows) ? body.rows : []).filter(
    (r): r is IngestRow => typeof r?.clientId === 'string' && r.clientId.length > 0,
  );
  const patches = Array.isArray(body.patches) ? body.patches : [];

  const accepted = await insertMessages(orgId, serverId ?? null, rows);
  await applyRoutingPatches(orgId, patches);

  return json({ ok: true, accepted, patched: patches.length });
};
