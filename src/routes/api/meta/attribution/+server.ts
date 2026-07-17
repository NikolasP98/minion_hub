import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { attributionFromReferral, upsertLeadAttribution } from '$server/services/meta/attribution.service';
import type { AttributionRelayBody } from '$server/services/meta/attribution.types';

/**
 * POST /api/meta/attribution — Tier 3 going-forward capture. The gateway
 * meta-graph extension relays an IG Click-to-Direct `message.referral` here on
 * the first message of an ad-driven thread. Authenticated by Bearer $CRON_SECRET
 * (same convention as the meta sync tick), so this path is in the hooks.server.ts
 * unauth allowlist. Resolves the recipient (IG business id) → org via meta_assets,
 * then upserts an exact (provenance='webhook') LeadAttribution.
 */
const handle: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  let body: AttributionRelayBody;
  try {
    body = (await request.json()) as AttributionRelayBody;
  } catch {
    throw error(400, 'invalid json');
  }

  const senderId = body.senderId?.trim();
  const recipientId = body.recipientId?.trim();
  if (!senderId || !recipientId || !body.referral) {
    throw error(400, 'senderId, recipientId and referral are required');
  }
  const channel = body.channel?.trim() || 'instagram';

  // Resolve the receiving IG business id → org. meta_assets has forced RLS, but
  // plain getCoreDb() connects as a bypass role (like listConnectedOrgIds) — we
  // don't yet know the org, so we look it up across orgs by the unique asset id.
  const db = getCoreDb();
  const [asset] = (await db.execute(sql`
    select org_id from meta_assets
    where kind = 'ig' and external_id = ${recipientId}
    limit 1
  `)) as unknown as Array<{ org_id: string }>;
  if (!asset?.org_id) {
    // Unknown recipient (asset not connected / not an IG asset). ACK so the
    // gateway doesn't retry a payload we can never attribute.
    return json({ ok: false, reason: 'unmapped-recipient' });
  }

  const ctx: CoreCtx = { db, tenantId: asset.org_id };
  const firstContactAt =
    typeof body.timestampMs === 'number' ? new Date(body.timestampMs).toISOString() : null;

  const attribution = await attributionFromReferral(ctx, {
    channel,
    senderId,
    messageId: body.messageId ?? null,
    chatId: body.chatId ?? null,
    firstContactAt,
    referral: body.referral,
  });
  await upsertLeadAttribution(ctx, attribution);

  return json({ ok: true });
};

export const POST = handle;
