import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { channels } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import { toResolvedChannels } from '$server/services/channel-publish.service';

/**
 * Internal gateway→hub hydration (ticket P1-T1). The gateway PULLS its resolved
 * channel projections (DB-authoritative) here, because the serverless hub can't push
 * and the hub/gateway Valkey instances aren't shared (the tracer finding).
 *
 * Auth = the SAME gateway metrics Bearer that authenticates /api/messages/ingest:
 * `resolveIdentity` sets `locals.serverId` ONLY for that bearer, and the unauth
 * fallback never sets it — so requiring `serverId` keeps this gateway-only. Lives
 * under /api/internal/* which hooks.server.ts gate-bypasses for server-to-server
 * handlers that do their own auth (no allowlist edit needed).
 *
 * Cross-org by design: the gateway runs every org's accounts, so it gets them all
 * (getCoreDb RLS-bypass, gateway-filtered — mirrors reconcileOrgConfig). Projection
 * is the allowlisted set only — never credentials.
 */

export const GET: RequestHandler = async ({ locals }) => {
  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!locals.tenantCtx || !serverId) throw error(401, 'Unauthorized');
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) throw error(401, 'Unknown gateway');

  const rows = await getCoreDb()
    .select({
      type: channels.type,
      accountId: channels.accountId,
      tenantId: channels.tenantId,
      enabled: channels.enabled,
      allowFrom: channels.allowFrom,
      groupAllowFrom: channels.groupAllowFrom,
      requireMention: channels.requireMention,
      replies: channels.replies,
      settings: channels.settings,
      authRef: channels.authRef,
      // Raw column select: owner_profile_id isn't in the vendored @minion-stack/db
      // pgTable yet (P0 migration, not yet applied). Drop this sql<> cast once the
      // package ships the typed column.
      ownerProfileId: sql<string | null>`owner_profile_id`,
    })
    .from(channels)
    .where(eq(channels.gatewayId, gatewayId));

  return json({ channels: toResolvedChannels(rows) });
};
