import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getServerCtx } from '$server/auth/core-ctx';
import { importGatewayChannels, syncChannelToGateway } from '$server/services/channel-sync.service';

/**
 * Channel DB-sourcing triggers (#3).
 *   { action: 'import' }                          → gateway config.get → upsert channels DB
 *   { action: 'reconcile', accountId, type? }     → DB row → gateway config.patch (hot-reload)
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      accountId?: string;
      type?: 'whatsapp' | 'telegram' | 'discord';
    };

    if (body.action === 'import') {
      const res = await importGatewayChannels(ctx);
      return json({ ok: true, ...res });
    }
    if (body.action === 'reconcile') {
      if (!body.accountId) throw error(400, 'accountId required for reconcile');
      const patch = await syncChannelToGateway(ctx, body.accountId, body.type ?? 'whatsapp');
      return json({ ok: true, patch });
    }
    throw error(400, "action must be 'import' or 'reconcile'");
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[POST /api/servers/${params.id}/channels/sync]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
