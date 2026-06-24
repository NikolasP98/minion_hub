import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { listGatewaysForAdmin } from '$server/services/gateway.pg.service';
import { reconcileOrgConfig } from '$server/services/org-config-sync.service';

/**
 * GET /api/org-config/tick — cron entrypoint that re-pushes the DB-authoritative
 * org maps (channels.accountOrgs + plugins.orgDisabled) to each gateway, so a
 * fresh-disk gateway redeploy recovers its org state and any drift self-heals.
 * Bearer $CRON_SECRET. Wire on netcup with an hourly crontab line (same shape as
 * the memberships tick). NOTE: new tick paths must also be in the hooks.server.ts
 * unauthenticated-API allowlist or they 401 before this handler runs.
 *
 * ponytail: single-gateway deploy — gatewayCall targets the configured gateway,
 * so reconciling each row hits that one gateway. For multi-gateway, route creds
 * per gateway inside reconcileOrgConfig.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  // gatewayCall targets the ONE system gateway (system creds), ignoring gw.id.
  // So reconciling any other gateway row pushes ITS db-derived maps (empty for a
  // gateway with no channel rows) to the system gateway — authoritative-replace
  // then NULLS OUT the real accountOrgs (org-isolation loss). Until gatewayCall
  // can route per-gateway, only reconcile reachable non-loopback gateways; in a
  // single-gateway deploy that's exactly the system one.
  // ponytail: replace the loopback filter with system-gateway matching when
  // multi-gateway (per-gateway creds) lands.
  const all = await listGatewaysForAdmin();
  const gateways = all.filter((g) => !/127\.0\.0\.1|localhost|\[::1\]/.test(g.url));
  const skipped = all.length - gateways.length;
  let reconciled = 0;
  let failed = 0;
  for (const gw of gateways) {
    try {
      await reconcileOrgConfig(gw.id);
      reconciled += 1;
    } catch (e) {
      console.error('[org-config] reconcile failed for gateway', gw.id, e);
      failed += 1;
    }
  }
  return json({ gateways: gateways.length, reconciled, failed, skipped });
};
