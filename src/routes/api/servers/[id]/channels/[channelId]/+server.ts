import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  getChannel,
  updateChannel,
  deleteChannel,
  isValidChannelStatus,
} from '$server/services/channel.service';
import { getServerCtx } from '$server/auth/core-ctx';
import { ensureGatewayWhatsappAccountSafe } from '$server/services/org-config-sync.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);
  try {
    const channel = await getChannel(ctx, params.channelId!);
    if (!channel) throw error(404, 'Channel not found');
    return json({ channel });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[GET /api/servers/${params.id}/channels/${params.channelId}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);
  try {
    const existing = await getChannel(ctx, params.channelId!);
    if (!existing) throw error(404, 'Channel not found');

    const body = await request.json();

    const input: Record<string, unknown> = {};
    if (body.label !== undefined) input.label = body.label;
    if (typeof body.accountId === 'string' && body.accountId.trim()) {
      input.accountId = body.accountId.trim();
    }
    if (body.status !== undefined) {
      if (!isValidChannelStatus(body.status)) throw error(400, `Invalid status: ${body.status}`);
      input.status = body.status;
    }
    if (body.credentials !== undefined) input.credentials = body.credentials;
    if (body.credentialsMeta !== undefined) input.credentialsMeta = body.credentialsMeta;

    await updateChannel(ctx, params.channelId!, input);

    // On pair-persist (account_id bound to a phone), additively register the account
    // in gateway.json so a non-wizard channel survives the next gateway restart.
    // whatsapp only (token-less QR); no-op when the account is already configured.
    if (existing.type === 'whatsapp' && typeof input.accountId === 'string') {
      const label = typeof input.label === 'string' ? input.label : existing.label;
      await ensureGatewayWhatsappAccountSafe(ctx.gatewayId, input.accountId, label);
    }

    return json({ ok: true });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[PUT /api/servers/${params.id}/channels/${params.channelId}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) throw error(401);
  try {
    await deleteChannel(ctx, params.channelId!);
    return json({ ok: true });
  } catch (e) {
    console.error(`[DELETE /api/servers/${params.id}/channels/${params.channelId}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
