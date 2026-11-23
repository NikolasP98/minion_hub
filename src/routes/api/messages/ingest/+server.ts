import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireServerToken } from '$server/auth/authorize';
import { waitUntil } from '@vercel/functions';
import {
  insertMessagesDetailed,
  applyRoutingPatches,
  type IngestRow,
  type RoutingPatch,
} from '$server/services/messages.service';
import { advanceBrainCorpusJobNow } from '$server/services/brain-corpus-jobs.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  // Gateway token only: a browser session has tenantCtx but no serverId.
  const { tenantCtx, serverId } = requireServerToken(locals);
  const orgId = tenantCtx.tenantId;

  const body = (await request.json()) as { rows?: IngestRow[]; patches?: RoutingPatch[] };
  const rows = (Array.isArray(body.rows) ? body.rows : []).filter(
    (r): r is IngestRow => typeof r?.clientId === 'string' && r.clientId.length > 0,
  );
  const patches = Array.isArray(body.patches) ? body.patches : [];

  const ingest = await insertMessagesDetailed(orgId, serverId, rows);
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
