import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getServerCtx } from '$server/auth/core-ctx';
import { importGatewayChannels } from '$server/services/channel-sync.service';

/**
 * Channel DB-sourcing import (#3 step 3b): gateway config.get → upsert the org's
 * accounts into the channels DB. (DB→gateway reconcile is a one-off migration —
 * see scripts/reconcile-channels.ts; future channels are DB-native and applied to
 * the gateway from the UI over the browser's gateway WS.)
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);
  try {
    const res = await importGatewayChannels(ctx);
    return json({ ok: true, ...res });
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/channels/sync]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
