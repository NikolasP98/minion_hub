import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { waitUntil } from '@vercel/functions';
import {
  insertMessagesDetailed,
  applyRoutingPatches,
  type IngestRow,
  type RoutingPatch,
} from '$server/services/messages.service';
import { advanceBrainCorpusJobNow } from '$server/services/brain-corpus-jobs.service';

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

  const ingest = await insertMessagesDetailed(orgId, serverId ?? null, rows);
  await applyRoutingPatches(orgId, patches);

  // adapter-vercel's `platform.context` is Edge-only. This app deploys Node 22
  // functions, so use Vercel's official Node request-context API. Outside
  // Vercel the durable bg job remains queued for /api/jobs/tick.
  if (ingest.brainJobId && process.env.VERCEL === '1') {
    waitUntil(
      advanceBrainCorpusJobNow(ingest.brainJobId).catch((cause) => {
        console.error('[brain-corpus] immediate background advance failed', cause);
      }),
    );
  }

  return json({
    ok: true,
    accepted: ingest.accepted,
    acceptedClientIds: ingest.acceptedClientIds,
    patched: patches.length,
    patchedClientIds: patches.map((patch) => patch.clientId),
  });
};
